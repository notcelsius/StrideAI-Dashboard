from common import (
  error_response,
  get_project_group_record,
  group_payload,
  iso_now,
  normalize_group_id,
  options_response,
  parse_body,
  project_group_is_assigned,
  require_project_access,
  require_staff_role,
  resolve_access_context,
  response,
  table,
)


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    access = resolve_access_context(event)
    require_staff_role(access)

    body = parse_body(event)
    query_params = event.get("queryStringParameters") or {}
    project_id = body.get("projectId") or query_params.get("projectId") or access.get("projectId")
    group_id = normalize_group_id((event.get("pathParameters") or {}).get("groupId"))

    if not project_id:
      return error_response(400, "projectId is required")

    require_project_access(access, project_id)

    existing = get_project_group_record(project_id, group_id)
    if not existing:
      return error_response(404, "Group not found")
    if project_group_is_assigned(project_id, group_id):
      return error_response(409, "Group is assigned to subjects. Remove it from subjects before archiving.")

    archived_at = iso_now()
    table.update_item(
      Key={"pk": f"PROJECT#{project_id}", "sk": f"GROUP#{group_id}"},
      UpdateExpression="SET archivedAt = :archived_at, updatedAt = :updated_at",
      ExpressionAttributeValues={
        ":archived_at": archived_at,
        ":updated_at": archived_at,
      },
    )

    archived = dict(existing)
    archived["archivedAt"] = archived_at
    archived["updatedAt"] = archived_at
    return response(200, group_payload(archived))
  except ValueError as exc:
    return error_response(400, str(exc))
  except PermissionError as exc:
    return error_response(403, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
