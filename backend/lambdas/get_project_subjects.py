from common import (
  error_response,
  options_response,
  query_project_subjects,
  require_project_access,
  resolve_access_context,
  response,
  serialize_subject,
  is_staff_role,
)


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    project_id = (event.get("pathParameters") or {}).get("projectId", "")
    access = resolve_access_context(event)
    require_project_access(access, project_id)

    subjects = query_project_subjects(project_id)
    payload = [serialize_subject(subject, include_user_sub=is_staff_role(access["role"])) for subject in subjects]

    return response(200, {"projectId": project_id, "subjects": payload})
  except PermissionError as exc:
    return error_response(403, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
