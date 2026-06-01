from common import (
  error_response,
  get_query_param,
  options_response,
  query_user_locations,
  require_subject_access,
  resolve_access_context,
  response,
  serialize_location,
)


def lambda_handler(event, context):
  """Return a patient's current named-location labels.

  Two modes share one handler:
    - GET /subjects/{subjectId}/locations  (staff/dashboard): authorize via
      require_subject_access, then read the linked patient's labels.
    - GET /locations                       (self): a patient reads their own
      labels, useful for multi-device sync.

  Soft-deleted labels are excluded. A subject with no linked user (or no labels
  yet) returns an empty list rather than an error so the dashboard renders
  cleanly.
  """
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    access = resolve_access_context(event)
    subject_id = (event.get("pathParameters") or {}).get("subjectId", "")

    if not subject_id:
      # Self-read: the caller's own labels.
      locations = query_user_locations(access["callerSub"])
      return response(200, {"locations": [serialize_location(item) for item in locations]})

    project_id = get_query_param(event, "projectId")
    subject = require_subject_access(access, subject_id, project_id)
    resolved_project_id = subject.get("projectId") or project_id or access["projectId"]
    subject_sub = subject.get("userSub")

    locations = query_user_locations(subject_sub) if subject_sub else []
    return response(
      200,
      {
        "subjectId": subject_id,
        "projectId": resolved_project_id,
        "locations": [serialize_location(item) for item in locations],
      },
    )
  except PermissionError as exc:
    return error_response(403, str(exc))
  except LookupError as exc:
    return error_response(404, str(exc))
  except ValueError as exc:
    return error_response(400, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
