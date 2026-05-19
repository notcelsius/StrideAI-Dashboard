from common import error_response, options_response, resolve_access_context, response


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    access = resolve_access_context(event)
    if not access.get("projectId") or not access.get("project"):
      return response(200, {"projects": []})

    project = access["project"]
    return response(
      200,
      {
        "projects": [
          {
            "projectId": access["projectId"],
            "projectName": project.get("projectName") or access["projectId"],
            "piName": project.get("piName") or "",
            "adminName": project.get("adminName") or "",
          }
        ]
      },
    )
  except PermissionError as exc:
    return error_response(401, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
