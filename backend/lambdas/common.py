import base64
import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key


TABLE_NAME = os.environ.get("TABLE_NAME", "StrideAI")
BUCKET_NAME = os.environ.get("BUCKET_NAME", "stride-ai-s3")
REGION = os.environ.get("AWS_REGION", "us-east-2")
UPLOAD_INDEX_NAME = os.environ.get("UPLOAD_INDEX_NAME", "GSI1")

CSV_CONTENT_TYPES = {"text/csv", "application/csv", "application/vnd.ms-excel"}

dynamo = boto3.resource("dynamodb", region_name=REGION)
table = dynamo.Table(TABLE_NAME)
s3_client = boto3.client("s3", region_name=REGION)


def response(status, body, content_type="application/json"):
  payload = body if isinstance(body, str) else json.dumps(body, default=serialize_value)
  return {
    "statusCode": status,
    "headers": {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
      "Content-Type": content_type,
    },
    "body": payload,
  }


def error_response(status, message, details=None):
  body = {"error": message}
  if details:
    body["details"] = details
  return response(status, body)


def options_response():
  return response(200, {"ok": True})


def serialize_value(value):
  if isinstance(value, Decimal):
    return float(value)
  return value


def parse_body(event):
  body = event.get("body")
  if body is None:
    return {}
  if isinstance(body, dict):
    return body
  if event.get("isBase64Encoded"):
    body = base64.b64decode(body).decode("utf-8")
  return json.loads(body or "{}")


def get_query_param(event, key, default=None):
  params = event.get("queryStringParameters") or {}
  return params.get(key, default)


def extract_claims(event):
  authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
  if isinstance(authorizer.get("claims"), dict):
    return authorizer["claims"]
  jwt = authorizer.get("jwt") or {}
  if isinstance(jwt.get("claims"), dict):
    return jwt["claims"]
  return {}


def extract_cognito_sub(event):
  claims = extract_claims(event)
  if claims.get("sub"):
    return claims["sub"]

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


def normalize_groups(raw_groups):
  if isinstance(raw_groups, list):
    return raw_groups
  if isinstance(raw_groups, str) and raw_groups.strip():
    return [raw_groups]
  return []


def resolve_role(claims):
  groups = set(normalize_groups(claims.get("cognito:groups")))
  if "admin" in groups or "pi_admin" in groups:
    return "admin"
  if "coordinator" in groups:
    return "coordinator"
  if "patient" in groups:
    return "patient"
  return "user"


def get_item(pk, sk):
  return table.get_item(Key={"pk": pk, "sk": sk}).get("Item")


def resolve_access_context(event):
  caller_sub = extract_cognito_sub(event)
  if not caller_sub:
    raise PermissionError("Unauthorized: could not resolve user identity")

  claims = extract_claims(event)
  role = resolve_role(claims)
  profile = get_item(f"USER#{caller_sub}", "PROFILE")
  if not profile:
    return {
      "callerSub": caller_sub,
      "role": role,
      "profile": None,
      "projectId": "",
      "project": None,
      "username": claims.get("preferred_username") or claims.get("email") or caller_sub,
    }

  project_id = profile.get("projectId") or ""
  project = get_item(f"PROJECT#{project_id}", "METADATA") if project_id else None
  return {
    "callerSub": caller_sub,
    "role": role,
    "profile": profile,
    "projectId": project_id,
    "project": project,
    "username": profile.get("username") or claims.get("preferred_username") or claims.get("email") or caller_sub,
  }


def require_project_access(access_context, project_id):
  if access_context["role"] == "admin":
    return
  if not project_id or access_context.get("projectId") != project_id:
    raise PermissionError("Forbidden: you do not have access to this project")


def get_subject_record(project_id, subject_id):
  if not project_id or not subject_id:
    return None
  return get_item(f"PROJECT#{project_id}", f"SUBJECT#{subject_id}")


def require_subject_access(access_context, subject_id):
  project_id = access_context.get("projectId", "")
  require_project_access(access_context, project_id)

  subject = get_subject_record(project_id, subject_id)
  if not subject:
    raise LookupError("Subject not found")

  if access_context["role"] == "patient":
    linked_sub = subject.get("userSub")
    if linked_sub and linked_sub != access_context["callerSub"]:
      raise PermissionError("Forbidden: patient access is limited to the assigned subject")

  return subject


def require_csv_upload(file_name, content_type):
  normalized_type = (content_type or "").strip().lower()
  if normalized_type not in CSV_CONTENT_TYPES:
    raise ValueError("contentType must be a supported CSV MIME type")
  if not str(file_name or "").lower().endswith(".csv"):
    raise ValueError("fileName must end with .csv")


def iso_now():
  return datetime.now(timezone.utc).isoformat()


def parse_iso_date(value):
  return datetime.strptime(value, "%Y-%m-%d")


def query_project_subjects(project_id):
  response = table.query(
    KeyConditionExpression=Key("pk").eq(f"PROJECT#{project_id}") & Key("sk").begins_with("SUBJECT#")
  )
  items = response.get("Items", [])
  return sorted(items, key=lambda item: item.get("subjectId", ""))


def query_daily_metrics(user_sub, start_date, end_date):
  response = table.query(
    KeyConditionExpression=Key("pk").eq(f"USER#{user_sub}") & Key("sk").between(
      f"DAY#{start_date}",
      f"DAY#{end_date}",
    ),
    FilterExpression=Attr("entityType").eq("DAILY_METRIC"),
  )
  items = response.get("Items", [])
  return sorted(items, key=lambda item: item.get("date", ""))


def build_upload_gsi_keys(user_sub, created_at, upload_pk):
  return {
    "GSI1PK": f"USER#{user_sub}",
    "GSI1SK": f"CREATED#{created_at}#{upload_pk}",
  }


def query_uploads_for_user(user_sub, start_date, end_date):
  start_timestamp = f"{start_date}T00:00:00+00:00"
  end_timestamp = f"{end_date}T23:59:59.999999+00:00"
  response = table.query(
    IndexName=UPLOAD_INDEX_NAME,
    KeyConditionExpression=Key("GSI1PK").eq(f"USER#{user_sub}") & Key("GSI1SK").between(
      f"CREATED#{start_timestamp}",
      f"CREATED#{end_timestamp}#z",
    ),
  )
  return sorted(response.get("Items", []), key=lambda item: item.get("createdAt", ""))


def generate_download_url(file_key, expires_in=300):
  return s3_client.generate_presigned_url(
    "get_object",
    Params={"Bucket": BUCKET_NAME, "Key": file_key},
    ExpiresIn=expires_in,
    HttpMethod="GET",
  )
