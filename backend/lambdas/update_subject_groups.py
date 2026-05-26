from common import (
  error_response,
  get_subject_record,
  iso_now,
  normalize_subject_groups,
  options_response,
  parse_body,
  require_project_access,
  require_staff_role,
  resolve_access_context,
  response,
  serialize_subject,
  subject_groups,
  table,
)


VALID_MODES = {"replace", "add", "remove", "clear"}


def body_subject_ids(body):
  subject_ids = []
  raw_subject_ids = body.get("subjectIds")
  if isinstance(raw_subject_ids, list):
    subject_ids.extend(str(subject_id).strip() for subject_id in raw_subject_ids)
  elif raw_subject_ids:
    subject_ids.extend(str(raw_subject_ids).split(","))

  if body.get("subjectId"):
    subject_ids.append(str(body.get("subjectId")).strip())

  deduped = []
  seen = set()
  for subject_id in subject_ids:
    subject_id = str(subject_id).strip()
    if not subject_id or subject_id in seen:
      continue
    seen.add(subject_id)
    deduped.append(subject_id)
  return deduped


def merge_groups(current_groups, requested_groups, mode):
  if mode == "clear":
    return []

  requested_ids = {group["groupId"].lower() for group in requested_groups}
  if mode == "remove":
    return [group for group in current_groups if group["groupId"].lower() not in requested_ids]

  if mode == "add":
    return normalize_subject_groups(current_groups + requested_groups)

  return requested_groups


def update_subject_group_record(project_id, subject_id, groups):
  now = iso_now()
  group_ids = [group["groupId"] for group in groups]
  group_names = [group["groupName"] for group in groups]
  primary_group_id = group_ids[0] if group_ids else ""
  primary_group_name = group_names[0] if group_names else ""

  table.update_item(
    Key={"pk": f"PROJECT#{project_id}", "sk": f"SUBJECT#{subject_id}"},
    UpdateExpression=(
      "SET #groups = :groups, groupIds = :group_ids, groupNames = :group_names, "
      "groupId = :group_id, groupName = :group_name, updatedAt = :updated_at"
    ),
    ExpressionAttributeNames={"#groups": "groups"},
    ExpressionAttributeValues={
      ":groups": groups,
      ":group_ids": group_ids,
      ":group_names": group_names,
      ":group_id": primary_group_id,
      ":group_name": primary_group_name,
      ":updated_at": now,
    },
  )


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    access = resolve_access_context(event)
    require_staff_role(access)

    body = parse_body(event)
    project_id = body.get("projectId") or access.get("projectId")
    subject_ids = body_subject_ids(body)
    mode = (body.get("mode") or "replace").strip().lower()

    if mode not in VALID_MODES:
      return error_response(400, "mode must be one of replace, add, remove, or clear")
    if not project_id or not subject_ids:
      return error_response(400, "projectId and subjectId or subjectIds are required")

    requested_groups = normalize_subject_groups(
      body.get("groups"),
      body.get("groupId"),
      body.get("groupName"),
    )
    if mode != "clear" and not requested_groups:
      return error_response(400, "groups or groupId is required unless mode is clear")

    require_project_access(access, project_id)

    updated_subjects = []
    for subject_id in subject_ids:
      subject = get_subject_record(project_id, subject_id)
      if not subject:
        return error_response(404, f"Subject not found: {subject_id}")

      groups = merge_groups(subject_groups(subject), requested_groups, mode)
      update_subject_group_record(project_id, subject_id, groups)
      updated_subject = dict(subject)
      updated_subject["groups"] = groups
      updated_subject["groupIds"] = [group["groupId"] for group in groups]
      updated_subjects.append(serialize_subject(updated_subject, include_user_sub=True))

    return response(
      200,
      {
        "projectId": project_id,
        "mode": mode,
        "updatedCount": len(updated_subjects),
        "subjects": updated_subjects,
      },
    )
  except PermissionError as exc:
    return error_response(403, str(exc))
  except ValueError as exc:
    return error_response(400, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
