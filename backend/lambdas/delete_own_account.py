import os

import boto3
from boto3.dynamodb.conditions import Key

from common import (
    error_response,
    extract_claims,
    extract_cognito_sub,
    get_item,
    options_response,
    response,
    table,
)

REGION = os.environ.get("AWS_REGION", "us-east-2")
PATIENT_POOL_ID = "us-east-2_xQiH4YW8S"
cognito = boto3.client("cognito-idp", region_name=REGION)


def lambda_handler(event, context):
    try:
        method = (event.get("httpMethod") or "").upper()
        if method == "OPTIONS":
            return options_response()

        caller_sub = extract_cognito_sub(event)
        if not caller_sub:
            return error_response(401, "Unauthorized: could not resolve user identity")

        claims = extract_claims(event)
        username = claims.get("cognito:username") or claims.get("preferred_username") or ""

        deleted = {"dynamoProfile": False, "dailyMetrics": False, "cognitoUser": False, "subjectUnlinked": False}

        profile = get_item(f"USER#{caller_sub}", "PROFILE")
        if not profile:
            return error_response(404, "No profile found for this account")

        project_id = profile.get("projectId", "")

        table.delete_item(Key={"pk": f"USER#{caller_sub}", "sk": "PROFILE"})
        deleted["dynamoProfile"] = True

        metrics_resp = table.query(
            KeyConditionExpression=Key("pk").eq(f"USER#{caller_sub}") & Key("sk").begins_with("DAY#")
        )
        with table.batch_writer() as batch:
            for item in metrics_resp.get("Items", []):
                batch.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})
        deleted["dailyMetrics"] = len(metrics_resp.get("Items", [])) > 0

        if project_id:
            subjects_resp = table.query(
                KeyConditionExpression=Key("pk").eq(f"PROJECT#{project_id}") & Key("sk").begins_with("SUBJECT#"),
                FilterExpression=boto3.dynamodb.conditions.Attr("userSub").eq(caller_sub),
            )
            for subject in subjects_resp.get("Items", []):
                table.update_item(
                    Key={"pk": subject["pk"], "sk": subject["sk"]},
                    UpdateExpression="REMOVE userSub",
                )
                deleted["subjectUnlinked"] = True

        if username:
            try:
                cognito.admin_delete_user(UserPoolId=PATIENT_POOL_ID, Username=username)
                deleted["cognitoUser"] = True
            except cognito.exceptions.UserNotFoundException:
                pass

        return response(200, {"deleted": deleted})
    except Exception as exc:
        return error_response(500, "Internal server error", str(exc))
