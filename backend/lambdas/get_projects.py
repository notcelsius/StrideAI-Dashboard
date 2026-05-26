from common import error_response, list_accessible_projects, options_response, project_payload, resolve_access_context, response


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    access = resolve_access_context(event)
    projects = list_accessible_projects(access)
    return response(200, {"projects": [project_payload(project) for project in projects]})
  except PermissionError as exc:
    return error_response(401, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
