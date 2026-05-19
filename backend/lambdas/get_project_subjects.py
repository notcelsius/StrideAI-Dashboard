from common import (
  error_response,
  options_response,
  query_project_subjects,
  require_project_access,
  resolve_access_context,
  response,
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
    is_admin = access["role"] in {"admin", "coordinator"}
    payload = [
      {
        "subjectId": subject.get("subjectId"),
        "participantName": subject.get("participantName") or subject.get("subjectId"),
        "status": subject.get("status") or "Unknown",
        "lastUploadAt": subject.get("lastUploadAt") or "",
        **({"userSub": subject.get("userSub", "")} if is_admin else {}),
      }
      for subject in subjects
    ]

    return response(200, {"projectId": project_id, "subjects": payload})
  except PermissionError as exc:
    return error_response(403, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
