from common import (
  error_response,
  get_project_group_record,
  group_id_from_name,
  group_name_conflicts,
  group_payload,
  iso_now,
  normalize_group_id,
  normalize_group_name,
  options_response,
  parse_body,
  require_project_access,
  require_staff_role,
  resolve_access_context,
  response,
  table,
  update_assigned_subject_group_name,
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
    group_name = normalize_group_name(body.get("groupName") or body.get("name"))
    raw_group_id = str(body.get("groupId") or "").strip()
    group_id = normalize_group_id(raw_group_id) if raw_group_id else group_id_from_name(group_name)

    if not project_id:
      return error_response(400, "projectId is required")

    require_project_access(access, project_id)

    existing = get_project_group_record(project_id, group_id)
    if existing and not raw_group_id and not existing.get("archivedAt"):
      return error_response(409, "Group already exists")
    if group_name_conflicts(project_id, group_name, group_id):
      return error_response(409, "Group name already exists in this project")

    now = iso_now()
    item = {
      "pk": f"PROJECT#{project_id}",
      "sk": f"GROUP#{group_id}",
      "entityType": "GROUP",
      "projectId": project_id,
      "groupId": group_id,
      "groupName": group_name,
      "createdBy": existing.get("createdBy") if existing else access["callerSub"],
      "createdAt": existing.get("createdAt") if existing else now,
      "updatedAt": now,
    }

    table.put_item(Item=item)
    if existing and existing.get("groupName") != group_name:
      update_assigned_subject_group_name(project_id, group_id, group_name)

    return response(200 if existing else 201, group_payload(item))
  except ValueError as exc:
    return error_response(400, str(exc))
  except PermissionError as exc:
    return error_response(403, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
