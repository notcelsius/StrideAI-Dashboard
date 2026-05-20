import base64
import json
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import boto3


TABLE_NAME = os.environ.get("TABLE_NAME", "StrideAI")
REGION = os.environ.get("AWS_REGION", "us-east-2")

dynamo = boto3.resource("dynamodb", region_name=REGION)
table = dynamo.Table(TABLE_NAME)


def lambda_handler(event, context):
    try:
        method = (
            event.get("requestContext", {}).get("http", {}).get("method")
            or event.get("httpMethod")
            or ""
        ).upper()

        if method == "OPTIONS":
            return response(200, {"ok": True})

        cognito_sub = extract_cognito_sub(event)
        if not cognito_sub:
            return error_response(401, "Unauthorized: could not resolve user identity")

        body = parse_body(event)
        raw_days = body.get("days")
        if not isinstance(raw_days, list) or not raw_days:
            return error_response(400, "days must be a non-empty array")

        username, project_name, pi_name, admin_name = get_user_and_project(cognito_sub)

        upserted = []
        for raw_day in raw_days:
            validated = validate_day_payload(raw_day)
            item = add_daily_metric_delta(
                cognito_sub=cognito_sub,
                username=username,
                project_name=project_name,
                pi_name=pi_name,
                admin_name=admin_name,
                day=validated,
            )
            upserted.append(
                {
                    "date": item["date"],
                    "miles": float(item.get("miles", 0)),
                    "distanceMeters": float(item.get("distanceMeters", 0)),
                    "sessionCount": int(item.get("sessionCount", 0)),
                }
            )

        return response(
            200,
            {
                "ok": True,
                "userId": cognito_sub,
                "upsertedCount": len(upserted),
                "days": upserted,
            },
        )
    except ValueError as exc:
        return error_response(400, str(exc))
    except Exception as exc:
        import traceback

        traceback.print_exc()
        return error_response(500, "Internal server error", str(exc))


def extract_cognito_sub(event):
    try:
        return event["requestContext"]["authorizer"]["claims"]["sub"]
    except (KeyError, TypeError):
        pass

    try:
        jwt_claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        if isinstance(jwt_claims, dict):
            return jwt_claims.get("sub")
    except (KeyError, TypeError):
        pass

    try:
        headers = event.get("headers") or {}
        auth_header = headers.get("Authorization") or headers.get("authorization") or ""
        token = auth_header.replace("Bearer ", "").strip()
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.b64decode(payload_b64).decode("utf-8"))
        return payload.get("sub")
    except Exception:
        return None


def parse_body(event):
    body = event.get("body")
    if body is None:
        return {}
    if isinstance(body, dict):
        return body
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    return json.loads(body or "{}")


def get_user_and_project(cognito_sub):
    default_username = "unknown_user"
    default_project = "unassigned"
    default_pi = "unknown_pi"
    default_admin = "unknown_admin"

    user_resp = table.get_item(Key={"pk": f"USER#{cognito_sub}", "sk": "PROFILE"})
    user = user_resp.get("Item")
    if not user:
        return default_username, default_project, default_pi, default_admin

    username = user.get("username") or default_username
    project_id = user.get("projectId")

    if not project_id:
        return username, default_project, default_pi, default_admin

    proj_resp = table.get_item(Key={"pk": f"PROJECT#{project_id}", "sk": "METADATA"})
    project = proj_resp.get("Item")
    if not project:
        return username, default_project, default_pi, default_admin

    return (
        username,
        project.get("projectName") or default_project,
        project.get("piName") or default_pi,
        project.get("adminName") or default_admin,
    )


def validate_day_payload(raw_day):
    if not isinstance(raw_day, dict):
        raise ValueError("Each entry in days must be an object")

    date = raw_day.get("date")
    if not isinstance(date, str):
        raise ValueError("Each day must include date in YYYY-MM-DD format")

    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"Invalid date '{date}'; expected YYYY-MM-DD") from exc

    miles = parse_decimal(raw_day.get("miles", 0), "miles")
    distance_meters = parse_decimal(raw_day.get("distanceMeters", 0), "distanceMeters")
    session_count = raw_day.get("sessionCount", 0)
    if not isinstance(session_count, int) or session_count < 0:
        raise ValueError("sessionCount must be a non-negative integer")

    if miles < 0:
        raise ValueError("miles must be non-negative")
    if distance_meters < 0:
        raise ValueError("distanceMeters must be non-negative")

    return {
        "date": date,
        "miles": miles,
        "distanceMeters": distance_meters,
        "sessionCount": session_count,
    }


def parse_decimal(value, field_name):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be numeric") from exc


def add_daily_metric_delta(cognito_sub, username, project_name, pi_name, admin_name, day):
    timestamp = datetime.now(timezone.utc).isoformat()
    date = day["date"]

    result = table.update_item(
        Key={"pk": f"USER#{cognito_sub}", "sk": f"DAY#{date}"},
        UpdateExpression=(
            "SET entityType = :entity_type, userId = :user_id, #date = :date, "
            "username = :username, projectName = :project_name, piName = :pi_name, "
            "adminName = :admin_name, updatedAt = :updated_at "
            "ADD miles :miles, distanceMeters :distance_meters, sessionCount :session_count"
        ),
        ExpressionAttributeNames={"#date": "date"},
        ExpressionAttributeValues={
            ":entity_type": "DAILY_METRIC",
            ":user_id": cognito_sub,
            ":date": date,
            ":username": username,
            ":project_name": project_name,
            ":pi_name": pi_name,
            ":admin_name": admin_name,
            ":updated_at": timestamp,
            ":miles": day["miles"],
            ":distance_meters": day["distanceMeters"],
            ":session_count": day["sessionCount"],
        },
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes", {})


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "OPTIONS,POST",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body),
    }


def error_response(status, message, details=None):
    body = {"error": message}
    if details:
        body["details"] = details
    return response(status, body)
