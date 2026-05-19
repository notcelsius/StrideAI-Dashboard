import os

import boto3

from common import (
    error_response,
    options_response,
    parse_body,
    resolve_access_context,
    response,
    table,
)

REGION = os.environ.get("AWS_REGION", "us-east-2")
cognito = boto3.client("cognito-idp", region_name=REGION)


def lambda_handler(event, context):
    try:
        method = (event.get("httpMethod") or "").upper()
        if method == "OPTIONS":
            return options_response()

        access = resolve_access_context(event)
        if access["role"] not in {"admin"}:
            return error_response(403, "Forbidden: only admins can delete users")

        body = parse_body(event)
        user_sub = body.get("userSub")
        user_pool_id = body.get("userPoolId")
        username = body.get("username")
        project_id = body.get("projectId") or access.get("projectId")

        if not user_sub:
            return error_response(400, "userSub is required")

        deleted = {"dynamoProfile": False, "cognitoUser": False, "subjectUnlinked": False}

        profile = table.get_item(Key={"pk": f"USER#{user_sub}", "sk": "PROFILE"}).get("Item")
        if profile:
            table.delete_item(Key={"pk": f"USER#{user_sub}", "sk": "PROFILE"})
            deleted["dynamoProfile"] = True

        if project_id:
            subjects_resp = table.query(
                KeyConditionExpression=boto3.dynamodb.conditions.Key("pk").eq(f"PROJECT#{project_id}")
                & boto3.dynamodb.conditions.Key("sk").begins_with("SUBJECT#"),
                FilterExpression=boto3.dynamodb.conditions.Attr("userSub").eq(user_sub),
            )
            for subject in subjects_resp.get("Items", []):
                table.update_item(
                    Key={"pk": subject["pk"], "sk": subject["sk"]},
                    UpdateExpression="REMOVE userSub",
                )
                deleted["subjectUnlinked"] = True

        if user_pool_id and username:
            try:
                cognito.admin_delete_user(UserPoolId=user_pool_id, Username=username)
                deleted["cognitoUser"] = True
            except cognito.exceptions.UserNotFoundException:
                pass

        return response(200, {"userSub": user_sub, "deleted": deleted})
    except Exception as exc:
        return error_response(500, "Internal server error", str(exc))
