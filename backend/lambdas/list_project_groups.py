from common import (
  error_response,
  group_payload,
  options_response,
  query_project_groups,
  require_project_access,
  require_staff_role,
  resolve_access_context,
  response,
)


def truthy(value):
  return str(value or "").strip().lower() in {"1", "true", "yes"}


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    access = resolve_access_context(event)
    require_staff_role(access)

    project_id = (event.get("pathParameters") or {}).get("projectId", "")
    if not project_id:
      return error_response(400, "projectId is required")

    require_project_access(access, project_id)

    query_params = event.get("queryStringParameters") or {}
    include_archived = truthy(query_params.get("includeArchived"))
    groups = query_project_groups(project_id, include_archived=include_archived)

    return response(200, {
      "projectId": project_id,
      "groups": [group_payload(group) for group in groups],
    })
  except PermissionError as exc:
    return error_response(403, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
