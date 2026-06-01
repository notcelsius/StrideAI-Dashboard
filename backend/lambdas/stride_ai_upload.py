import base64
import json
import os
import uuid
from datetime import datetime, timezone

import boto3


BUCKET_NAME = os.environ.get("BUCKET_NAME", "stride-ai-s3")
REGION = os.environ.get("AWS_REGION", "us-east-2")
TABLE_NAME = os.environ.get("TABLE_NAME", "StrideAI")

s3_client = boto3.client("s3", region_name=REGION, endpoint_url=f"https://s3.{REGION}.amazonaws.com")
dynamo = boto3.resource("dynamodb", region_name=REGION)
table = dynamo.Table(TABLE_NAME)


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
    default_project_id = ""
    default_project = "unassigned"
    default_pi = "unknown_pi"
    default_admin = "unknown_admin"
    default_subject_id = ""

    user_resp = table.get_item(Key={"pk": f"USER#{cognito_sub}", "sk": "PROFILE"})
    user = user_resp.get("Item")
    if not user:
        return default_username, default_project_id, default_project, default_pi, default_admin, default_subject_id

    username = user.get("username") or default_username
    project_id = user.get("projectId")
    subject_id = user.get("subjectId") or default_subject_id

    if not project_id:
        return username, default_project_id, default_project, default_pi, default_admin, subject_id

    proj_resp = table.get_item(Key={"pk": f"PROJECT#{project_id}", "sk": "METADATA"})
    project = proj_resp.get("Item")
    if not project:
        return username, project_id, default_project, default_pi, default_admin, subject_id

    return (
        username,
        project_id,
        project.get("projectName") or default_project,
        project.get("piName") or default_pi,
        project.get("adminName") or default_admin,
        subject_id,
    )


def save_upload_metadata(cognito_sub, username, project_id, project_name, pi_name, admin_name, file_key, file_name, content_type):
    upload_id = str(uuid.uuid4())
    upload_pk = f"UPLOAD#{upload_id}"
    created_at = datetime.now(timezone.utc).isoformat()
    table.put_item(
        Item={
            "pk": upload_pk,
            "sk": f"USER#{cognito_sub}",
            "GSI1PK": f"USER#{cognito_sub}",
            "GSI1SK": f"CREATED#{created_at}#{upload_pk}",
            "userId": cognito_sub,
            "username": username,
            "projectId": project_id,
            "projectName": project_name,
            "piName": pi_name,
            "adminName": admin_name,
            "fileKey": file_key,
            "fileName": file_name,
            "contentType": content_type,
            "status": "pending",
            "createdAt": created_at,
        }
    )
    return upload_id, created_at


def update_subject_last_upload(project_id, subject_id, timestamp):
    if not project_id or not subject_id:
        return

    try:
        table.update_item(
            Key={"pk": f"PROJECT#{project_id}", "sk": f"SUBJECT#{subject_id}"},
            UpdateExpression="SET lastUploadAt = :timestamp, updatedAt = :timestamp",
            ConditionExpression="attribute_exists(pk) AND attribute_exists(sk)",
            ExpressionAttributeValues={":timestamp": timestamp},
        )
    except Exception as exc:
        print(f"Unable to update subject lastUploadAt for {project_id}/{subject_id}: {exc}")


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
        file_name = body.get("fileName")
        content_type = body.get("contentType", "application/octet-stream")

        if not file_name:
            return error_response(400, "fileName is required")

        username, project_id, project_name, pi_name, admin_name, subject_id = get_user_and_project(cognito_sub)

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        file_key = f"{today}/{username}/{project_name}/{pi_name}/{admin_name}/{file_name}"

        presigned_url = s3_client.generate_presigned_url(
            "put_object",
            Params={"Bucket": BUCKET_NAME, "Key": file_key, "ContentType": content_type},
            ExpiresIn=300,
            HttpMethod="PUT",
        )

        upload_id, created_at = save_upload_metadata(
            cognito_sub,
            username,
            project_id,
            project_name,
            pi_name,
            admin_name,
            file_key,
            file_name,
            content_type,
        )
        update_subject_last_upload(project_id, subject_id, created_at)

        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,Authorization",
                "Access-Control-Allow-Methods": "OPTIONS,POST",
                "Content-Type": "application/json",
            },
            "body": json.dumps(
                {
                    "uploadUrl": presigned_url,
                    "fileKey": file_key,
                    "uploadId": upload_id,
                    "expiresIn": 300,
                }
            ),
        }

    except ValueError as exc:
        return error_response(400, str(exc))
    except Exception as exc:
        import traceback

        traceback.print_exc()
        return error_response(500, "Internal server error", str(exc))


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
