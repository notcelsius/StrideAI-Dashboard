from common import (
  is_csv_export,
  error_response,
  generate_download_url,
  get_item,
  get_query_param,
  options_response,
  parse_iso_date,
  query_uploads_for_user,
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

    subject_project_id = subject.get("projectId") or project_id or access["projectId"]
    subject_project = access["project"] if access["projectId"] == subject_project_id else get_item(f"PROJECT#{subject_project_id}", "METADATA")
    subject_project_name = (subject_project or {}).get("projectName")
    upload_items = query_uploads_for_user(subject_sub, start_date, end_date)
    files = []
    for item in upload_items:
      file_name = item.get("fileName") or ""
      matches_csv = is_csv_export(file_name, item.get("contentType"))
      matches_project = (
        item.get("projectId") == subject_project_id or
        (subject_project_name and item.get("projectName") == subject_project_name)
      )
      if not matches_csv or not matches_project:
        continue

      file_key = item.get("fileKey")
      if not file_key:
        continue

      files.append(
        {
          "uploadId": (item.get("pk") or "").replace("UPLOAD#", ""),
          "fileName": file_name,
          "fileKey": file_key,
          "contentType": item.get("contentType") or "text/csv",
          "createdAt": item.get("createdAt") or "",
          "downloadUrl": generate_download_url(file_key),
        }
      )

    return response(
      200,
      {
        "subjectId": subject_id,
        "projectId": subject_project_id,
        "range": {"start": start_date, "end": end_date},
        "files": files,
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
