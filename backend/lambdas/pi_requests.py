import hashlib
import os

import boto3
from boto3.dynamodb.conditions import Attr, Key

from common import (
  error_response,
  get_item,
  iso_now,
  normalize_email,
  options_response,
  parse_body,
  require_admin_role,
  require_project_access,
  resolve_access_context,
  response,
  table,
)


REGION = os.environ.get("AWS_REGION", "us-east-2")
PI_USER_POOL_ID = os.environ.get("PI_USER_POOL_ID", os.environ.get("USER_POOL_ID", "us-east-2_1AOUqzUwA"))
PI_GROUP_NAME = os.environ.get("PI_GROUP_NAME", "pi")

cognito = boto3.client("cognito-idp", region_name=REGION)


def pi_request_id(email, project_id):
  digest = hashlib.sha256(f"{email}:{project_id}".encode("utf-8")).hexdigest()[:16]
  return f"{project_id}-{digest}"


def request_key(request_id):
  return {"pk": "PI_REQUESTS", "sk": f"REQUEST#{request_id}"}


def serialize_request(item):
  return {
    "requestId": item.get("requestId", ""),
    "name": item.get("name", ""),
    "email": item.get("email", ""),
    "requestedProjectId": item.get("requestedProjectId", ""),
    "status": item.get("status", ""),
    "note": item.get("note", ""),
    "createdAt": item.get("createdAt", ""),
    "updatedAt": item.get("updatedAt", ""),
    "reviewedAt": item.get("reviewedAt", ""),
    "reviewedBy": item.get("reviewedBy", ""),
    "cognitoUsername": item.get("cognitoUsername", ""),
    "cognitoSub": item.get("cognitoSub", ""),
    "rejectionReason": item.get("rejectionReason", ""),
  }


def list_requests(status):
  items = []
  query_kwargs = {"KeyConditionExpression": Key("pk").eq("PI_REQUESTS") & Key("sk").begins_with("REQUEST#")}
  if status:
    query_kwargs["FilterExpression"] = Attr("status").eq(status)

  while True:
    resp = table.query(**query_kwargs)
    items.extend(resp.get("Items", []))
    last_key = resp.get("LastEvaluatedKey")
    if not last_key:
      break
    query_kwargs["ExclusiveStartKey"] = last_key

  return sorted(items, key=lambda item: item.get("createdAt", ""), reverse=True)


def get_path_request_id(event):
  params = event.get("pathParameters") or {}
  return params.get("requestId") or params.get("id") or ""


def create_pi_request(event):
  body = parse_body(event)
  name = str(body.get("name") or "").strip()
  email = normalize_email(body.get("email"))
  requested_project_id = str(
    body.get("requestedProjectId") or body.get("projectId") or body.get("studyId") or ""
  ).strip()
  note = str(body.get("note") or "").strip()

  if not name or not email or not requested_project_id:
    return error_response(400, "name, email, and requestedProjectId are required")
  if "@" not in email:
    return error_response(400, "email must be valid")
  if not get_item(f"PROJECT#{requested_project_id}", "METADATA"):
    return error_response(404, "Requested project not found")

  request_id = pi_request_id(email, requested_project_id)
  now = iso_now()
  key = request_key(request_id)
  item = {
    **key,
    "entityType": "PI_REQUEST",
    "requestId": request_id,
    "name": name,
    "email": email,
    "requestedProjectId": requested_project_id,
    "note": note,
    "status": "pending",
    "createdAt": now,
    "updatedAt": now,
  }

  existing = table.get_item(Key=key).get("Item")
  if existing and existing.get("status") == "pending":
    return response(200, serialize_request(existing))
  if existing:
    item["previousStatus"] = existing.get("status", "")

  table.put_item(Item=item)
  return response(201, serialize_request(item))


def list_pi_requests(event):
  access = resolve_access_context(event)
  require_admin_role(access)
  status = str((event.get("queryStringParameters") or {}).get("status") or "pending").strip().lower()
  if status == "all":
    status = ""
  items = list_requests(status)
  return response(200, {"requests": [serialize_request(item) for item in items]})


def find_cognito_user_by_email(email):
  resp = cognito.list_users(
    UserPoolId=PI_USER_POOL_ID,
    Filter=f'email = "{email}"',
    Limit=1,
  )
  users = resp.get("Users", [])
  return users[0] if users else None


def ensure_pi_cognito_user(item):
  email = item["email"]
  user = find_cognito_user_by_email(email)
  if not user:
    resp = cognito.admin_create_user(
      UserPoolId=PI_USER_POOL_ID,
      Username=email,
      UserAttributes=[
        {"Name": "email", "Value": email},
        {"Name": "email_verified", "Value": "true"},
        {"Name": "name", "Value": item.get("name", "")},
      ],
    )
    user = resp["User"]

  username = user["Username"]
  attributes = {attr["Name"]: attr["Value"] for attr in user.get("Attributes", [])}
  cognito.admin_add_user_to_group(
    UserPoolId=PI_USER_POOL_ID,
    Username=username,
    GroupName=PI_GROUP_NAME,
  )
  return username, attributes.get("sub", "")


def approve_pi_request(event):
  access = resolve_access_context(event)
  require_admin_role(access)

  request_id = get_path_request_id(event)
  if not request_id:
    return error_response(400, "requestId is required")

  item = table.get_item(Key=request_key(request_id)).get("Item")
  if not item:
    return error_response(404, "PI request not found")
  if item.get("status") == "rejected":
    return error_response(409, "Rejected PI requests cannot be approved")

  body = parse_body(event)
  project_id = str(body.get("projectId") or item.get("requestedProjectId") or "").strip()
  if not project_id:
    return error_response(400, "projectId is required")
  require_project_access(access, project_id)

  username, cognito_sub = ensure_pi_cognito_user(item)
  now = iso_now()
  if cognito_sub:
    table.update_item(
      Key={"pk": f"USER#{cognito_sub}", "sk": "PROFILE"},
      UpdateExpression=(
        "SET projectId = :project_id, username = :username, email = :email, "
        "#role = :role, updatedAt = :updated_at"
      ),
      ExpressionAttributeNames={"#role": "role"},
      ExpressionAttributeValues={
        ":project_id": project_id,
        ":username": item.get("name") or username,
        ":email": item["email"],
        ":role": "pi",
        ":updated_at": now,
      },
    )

  table.update_item(
    Key=request_key(request_id),
    UpdateExpression=(
      "SET #status = :status, requestedProjectId = :project_id, reviewedAt = :reviewed_at, "
      "reviewedBy = :reviewed_by, updatedAt = :updated_at, cognitoUsername = :username, cognitoSub = :sub"
    ),
    ExpressionAttributeNames={"#status": "status"},
    ExpressionAttributeValues={
      ":status": "approved",
      ":project_id": project_id,
      ":reviewed_at": now,
      ":reviewed_by": access["callerSub"],
      ":updated_at": now,
      ":username": username,
      ":sub": cognito_sub,
    },
  )

  updated = table.get_item(Key=request_key(request_id)).get("Item")
  return response(200, serialize_request(updated))


def reject_pi_request(event):
  access = resolve_access_context(event)
  require_admin_role(access)

  request_id = get_path_request_id(event)
  if not request_id:
    return error_response(400, "requestId is required")

  item = table.get_item(Key=request_key(request_id)).get("Item")
  if not item:
    return error_response(404, "PI request not found")
  if item.get("status") == "approved":
    return error_response(409, "Approved PI requests cannot be rejected")

  body = parse_body(event)
  now = iso_now()
  table.update_item(
    Key=request_key(request_id),
    UpdateExpression=(
      "SET #status = :status, reviewedAt = :reviewed_at, reviewedBy = :reviewed_by, "
      "updatedAt = :updated_at, rejectionReason = :reason"
    ),
    ExpressionAttributeNames={"#status": "status"},
    ExpressionAttributeValues={
      ":status": "rejected",
      ":reviewed_at": now,
      ":reviewed_by": access["callerSub"],
      ":updated_at": now,
      ":reason": str(body.get("reason") or "").strip(),
    },
  )

  updated = table.get_item(Key=request_key(request_id)).get("Item")
  return response(200, serialize_request(updated))


def handle_pi_request(handler, event):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()
    return handler(event)
  except PermissionError as exc:
    return error_response(403, str(exc))
  except cognito.exceptions.ResourceNotFoundException:
    return error_response(500, "Cognito user pool or group was not found")
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    action = (
      (event.get("pathParameters") or {}).get("action")
      or (event.get("queryStringParameters") or {}).get("action")
      or ""
    ).strip().lower()

    if method == "POST" and not action:
      return create_pi_request(event)
    if method == "GET":
      return list_pi_requests(event)
    if method == "POST" and action == "approve":
      return approve_pi_request(event)
    if method == "POST" and action == "reject":
      return reject_pi_request(event)

    return error_response(405, "Method not allowed")
  except PermissionError as exc:
    return error_response(403, str(exc))
  except cognito.exceptions.ResourceNotFoundException:
    return error_response(500, "Cognito user pool or group was not found")
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
