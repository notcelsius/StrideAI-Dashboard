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
DEFAULT_ADMIN_EMAIL_ALLOWLIST = "ehenricson@health.ucdavis.edu,ehenricson@ucdavis.edu"
DEFAULT_TEMP_ADMIN_EMAIL_ALLOWLIST = "rsheth@ucdavis.edu"
ADMIN_EMAIL_ALLOWLIST = os.environ.get("ADMIN_EMAIL_ALLOWLIST", DEFAULT_ADMIN_EMAIL_ALLOWLIST)
TEMP_ADMIN_EMAIL_ALLOWLIST = os.environ.get("TEMP_ADMIN_EMAIL_ALLOWLIST", DEFAULT_TEMP_ADMIN_EMAIL_ALLOWLIST)

CSV_CONTENT_TYPES = {"text/csv", "application/csv", "application/vnd.ms-excel"}
STAFF_ROLES = {"admin", "pi", "coordinator"}

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
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST,DELETE",
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
    return [str(group).strip() for group in raw_groups if str(group).strip()]
  if isinstance(raw_groups, str):
    value = raw_groups.strip()
    if not value:
      return []
    if value.startswith("["):
      try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
          return normalize_groups(parsed)
      except Exception:
        pass
    return [group.strip() for group in value.split(",") if group.strip()]
  return []


def resolve_role(claims):
  groups = {group.lower() for group in normalize_groups(claims.get("cognito:groups"))}
  if "admin" in groups:
    return "admin"
  if "pi" in groups:
    return "pi"
  if "coordinator" in groups:
    return "coordinator"
  if "patient" in groups:
    return "patient"
  return "user"


def is_staff_role(role):
  return role in STAFF_ROLES


def require_staff_role(access_context):
  if not is_staff_role(access_context.get("role")):
    raise PermissionError("Forbidden: only staff can perform this action")


def require_admin_role(access_context):
  if access_context.get("role") != "admin":
    raise PermissionError("Forbidden: only admins can perform this action")


def normalize_email(email):
  return str(email or "").strip().lower()


def allowed_admin_emails(include_temporary=True):
  emails = set(normalize_email(email) for email in parse_csv_list(ADMIN_EMAIL_ALLOWLIST))
  if include_temporary:
    emails.update(normalize_email(email) for email in parse_csv_list(TEMP_ADMIN_EMAIL_ALLOWLIST))
  return {email for email in emails if email}


def is_admin_email_allowed(email, include_temporary=True):
  return normalize_email(email) in allowed_admin_emails(include_temporary)


def require_admin_email_allowed(email, include_temporary=True):
  if not is_admin_email_allowed(email, include_temporary):
    raise PermissionError("Forbidden: email is not in the admin allowlist")


def get_item(pk, sk):
  return table.get_item(Key={"pk": pk, "sk": sk}).get("Item")


def parse_csv_list(value):
  if value is None:
    return []
  if isinstance(value, list):
    values = value
  else:
    values = str(value).split(",")
  return [str(item).strip() for item in values if str(item).strip()]


def normalize_project_ids(value):
  project_ids = []
  seen = set()
  for project_id in parse_csv_list(value):
    if project_id in seen:
      continue
    seen.add(project_id)
    project_ids.append(project_id)
  return project_ids


def normalize_subject_groups(raw_groups=None, group_id=None, group_name=None):
  groups = []
  if raw_groups is None:
    raw_groups = []
  if isinstance(raw_groups, (str, dict)):
    raw_groups = [raw_groups]
  if not isinstance(raw_groups, list):
    raise ValueError("groups must be an array, object, or string")

  for raw_group in raw_groups:
    if isinstance(raw_group, str):
      candidate_id = raw_group.strip()
      candidate_name = candidate_id
    elif isinstance(raw_group, dict):
      candidate_id = str(raw_group.get("groupId") or raw_group.get("id") or "").strip()
      candidate_name = str(raw_group.get("groupName") or raw_group.get("name") or "").strip()
      if not candidate_id:
        candidate_id = candidate_name
      if not candidate_name:
        candidate_name = candidate_id
    else:
      raise ValueError("Each group must be a string or object")

    if candidate_id:
      groups.append({"groupId": candidate_id, "groupName": candidate_name or candidate_id})

  if group_id or group_name:
    candidate_id = str(group_id or group_name or "").strip()
    candidate_name = str(group_name or group_id or "").strip()
    if candidate_id:
      groups.append({"groupId": candidate_id, "groupName": candidate_name or candidate_id})

  deduped = []
  seen = set()
  for group in groups:
    dedupe_key = group["groupId"].lower()
    if dedupe_key in seen:
      continue
    seen.add(dedupe_key)
    deduped.append(group)

  return deduped


def subject_groups(subject):
  return normalize_subject_groups(
    subject.get("groups") or [],
    subject.get("groupId") or "",
    subject.get("groupName") or "",
  )


def subject_group_ids(subject):
  explicit_ids = parse_csv_list(subject.get("groupIds"))
  ids = explicit_ids + [group["groupId"] for group in subject_groups(subject)]
  deduped = []
  seen = set()
  for group_id in ids:
    dedupe_key = group_id.lower()
    if dedupe_key in seen:
      continue
    seen.add(dedupe_key)
    deduped.append(group_id)
  return deduped


def subject_matches_group_filter(subject, group_ids):
  if not group_ids:
    return True
  wanted = {group_id.lower() for group_id in group_ids}
  subject_ids = subject_group_ids(subject)
  if not subject_ids and "ungrouped" in wanted:
    return True
  return any(group_id.lower() in wanted for group_id in subject_ids)


def serialize_subject(subject, include_user_sub=False):
  groups = subject_groups(subject)
  payload = {
    "subjectId": subject.get("subjectId"),
    "participantName": subject.get("participantName") or subject.get("subjectId"),
    "status": subject.get("status") or "Unknown",
    "lastUploadAt": subject.get("lastUploadAt") or "",
    "groups": groups,
    "groupIds": [group["groupId"] for group in groups],
  }
  if groups:
    payload["groupId"] = groups[0]["groupId"]
    payload["groupName"] = groups[0]["groupName"]
  if include_user_sub:
    payload["userSub"] = subject.get("userSub", "")
  return payload


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
      "projectIds": [],
      "project": None,
      "username": claims.get("preferred_username") or claims.get("email") or caller_sub,
    }

  project_id = profile.get("projectId") or ""
  project_ids = normalize_project_ids(profile.get("projectIds"))
  if not is_staff_role(role) and project_id:
    project_ids = normalize_project_ids(project_ids + [project_id])

  project = get_item(f"PROJECT#{project_id}", "METADATA") if project_id else None
  return {
    "callerSub": caller_sub,
    "role": role,
    "profile": profile,
    "projectId": project_id,
    "projectIds": project_ids,
    "project": project,
    "subjectId": profile.get("subjectId") or "",
    "username": profile.get("username") or claims.get("preferred_username") or claims.get("email") or caller_sub,
  }


def require_project_access(access_context, project_id):
  if access_context["role"] == "admin":
    return
  if not project_id or project_id not in access_context.get("projectIds", []):
    raise PermissionError("Forbidden: you do not have access to this project")


def get_subject_record(project_id, subject_id):
  if not project_id or not subject_id:
    return None
  return get_item(f"PROJECT#{project_id}", f"SUBJECT#{subject_id}")


def require_subject_access(access_context, subject_id, project_id=None):
  project_id = project_id or access_context.get("projectId", "")
  require_project_access(access_context, project_id)

  subject = get_subject_record(project_id, subject_id)
  if not subject:
    raise LookupError("Subject not found")

  if not is_staff_role(access_context["role"]):
    linked_sub = subject.get("userSub")
    if linked_sub != access_context["callerSub"]:
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


def query_all_project_metadata():
  items = []
  scan_kwargs = {"FilterExpression": Attr("sk").eq("METADATA")}
  while True:
    response = table.scan(**scan_kwargs)
    items.extend(response.get("Items", []))
    last_key = response.get("LastEvaluatedKey")
    if not last_key:
      break
    scan_kwargs["ExclusiveStartKey"] = last_key
  return sorted(items, key=lambda item: item.get("projectId") or item.get("pk", ""))


def list_accessible_projects(access_context, project_ids=None):
  requested_ids = parse_csv_list(project_ids)
  if access_context["role"] == "admin":
    if requested_ids:
      projects = []
      for project_id in requested_ids:
        project = get_item(f"PROJECT#{project_id}", "METADATA")
        if project:
          projects.append(project)
      return projects
    return query_all_project_metadata()

  accessible_ids = access_context.get("projectIds", [])
  if not accessible_ids:
    return []
  selected_ids = requested_ids or accessible_ids
  if any(project_id not in accessible_ids for project_id in selected_ids):
    raise PermissionError("Forbidden: you do not have access to this project")

  projects = []
  for project_id in selected_ids:
    project = get_item(f"PROJECT#{project_id}", "METADATA")
    if project:
      projects.append(project)
  return projects


def project_payload(project):
  project_id = project.get("projectId") or str(project.get("pk", "")).replace("PROJECT#", "")
  return {
    "projectId": project_id,
    "projectName": project.get("projectName") or project_id,
    "piName": project.get("piName") or "",
    "adminName": project.get("adminName") or "",
  }


def query_project_subjects(project_id):
  items = []
  query_kwargs = {
    "KeyConditionExpression": Key("pk").eq(f"PROJECT#{project_id}") & Key("sk").begins_with("SUBJECT#")
  }
  while True:
    response = table.query(**query_kwargs)
    items.extend(response.get("Items", []))
    last_key = response.get("LastEvaluatedKey")
    if not last_key:
      break
    query_kwargs["ExclusiveStartKey"] = last_key
  return sorted(items, key=lambda item: item.get("subjectId", ""))


def query_daily_metrics(user_sub, start_date, end_date):
  items = []
  query_kwargs = {
    "KeyConditionExpression": Key("pk").eq(f"USER#{user_sub}") & Key("sk").between(
      f"DAY#{start_date}",
      f"DAY#{end_date}",
    ),
    "FilterExpression": Attr("entityType").eq("DAILY_METRIC"),
  }
  while True:
    response = table.query(**query_kwargs)
    items.extend(response.get("Items", []))
    last_key = response.get("LastEvaluatedKey")
    if not last_key:
      break
    query_kwargs["ExclusiveStartKey"] = last_key
  return sorted(items, key=lambda item: item.get("date", ""))


def build_upload_gsi_keys(user_sub, created_at, upload_pk):
  return {
    "GSI1PK": f"USER#{user_sub}",
    "GSI1SK": f"CREATED#{created_at}#{upload_pk}",
  }


def query_uploads_for_user(user_sub, start_date, end_date):
  start_timestamp = f"{start_date}T00:00:00+00:00"
  end_timestamp = f"{end_date}T23:59:59.999999+00:00"
  items = []
  query_kwargs = {
    "IndexName": UPLOAD_INDEX_NAME,
    "KeyConditionExpression": Key("GSI1PK").eq(f"USER#{user_sub}") & Key("GSI1SK").between(
      f"CREATED#{start_timestamp}",
      f"CREATED#{end_timestamp}#z",
    ),
  }
  while True:
    response = table.query(**query_kwargs)
    items.extend(response.get("Items", []))
    last_key = response.get("LastEvaluatedKey")
    if not last_key:
      break
    query_kwargs["ExclusiveStartKey"] = last_key
  return sorted(items, key=lambda item: item.get("createdAt", ""))


def generate_download_url(file_key, expires_in=300):
  return s3_client.generate_presigned_url(
    "get_object",
    Params={"Bucket": BUCKET_NAME, "Key": file_key},
    ExpiresIn=expires_in,
    HttpMethod="GET",
  )
