from common import (
  error_response,
  get_query_param,
  options_response,
  parse_iso_date,
  query_daily_metrics,
  require_subject_access,
  resolve_access_context,
  response,
)


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    subject_id = (event.get("pathParameters") or {}).get("subjectId", "")
    start_date = get_query_param(event, "start")
    end_date = get_query_param(event, "end")
    project_id = get_query_param(event, "projectId")
    if not start_date or not end_date:
      return error_response(400, "start and end query params are required")
    if parse_iso_date(start_date) > parse_iso_date(end_date):
      return error_response(400, "start must be before or equal to end")

    access = resolve_access_context(event)
    subject = require_subject_access(access, subject_id, project_id)
    subject_sub = subject.get("userSub")
    if not subject_sub:
      return error_response(404, "Subject is not linked to a user yet")

    metrics = query_daily_metrics(subject_sub, start_date, end_date)
    daily_miles = [
      {
        "date": row.get("date"),
        "miles": round(float(row.get("miles", 0)), 2),
        "distanceMeters": round(float(row.get("distanceMeters", 0)), 2),
        "sessionCount": int(row.get("sessionCount", 0)),
      }
      for row in metrics
    ]
    total_miles = round(sum(row["miles"] for row in daily_miles), 2)
    average_miles = round(total_miles / len(daily_miles), 2) if daily_miles else 0

    return response(
      200,
      {
        "subjectId": subject_id,
        "projectId": subject.get("projectId") or project_id or access["projectId"],
        "range": {"start": start_date, "end": end_date},
        "dailyMiles": daily_miles,
        "totalMiles": total_miles,
        "averageMiles": average_miles,
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
