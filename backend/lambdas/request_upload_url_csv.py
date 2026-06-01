import os
import uuid

from common import (
  BUCKET_NAME,
  build_upload_gsi_keys,
  error_response,
  iso_now,
  options_response,
  parse_body,
  require_csv_upload,
  resolve_access_context,
  response,
  s3_client,
  table,
  update_subject_last_upload,
)


UPLOAD_URL_TTL_SECONDS = int(os.environ.get("UPLOAD_URL_TTL_SECONDS", "300"))


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    access = resolve_access_context(event)
    if not access.get("projectId") or not access.get("project"):
      return error_response(403, "Forbidden: user is not assigned to a project")

    body = parse_body(event)
    file_name = body.get("fileName")
    content_type = body.get("contentType", "text/csv")
    require_csv_upload(file_name, content_type)

    created_at = iso_now()
    upload_id = str(uuid.uuid4())
    upload_pk = f"UPLOAD#{upload_id}"
    project = access["project"]
    date_prefix = created_at[:10]
    file_key = (
      f"{date_prefix}/{access['username']}/"
      f"{project.get('projectName') or access['projectId']}/"
      f"{project.get('piName') or 'unknown_pi'}/"
      f"{project.get('adminName') or 'unknown_admin'}/"
      f"{file_name}"
    )

    presigned_url = s3_client.generate_presigned_url(
      "put_object",
      Params={"Bucket": BUCKET_NAME, "Key": file_key, "ContentType": content_type},
      ExpiresIn=UPLOAD_URL_TTL_SECONDS,
      HttpMethod="PUT",
    )

    item = {
      "pk": upload_pk,
      "sk": f"USER#{access['callerSub']}",
      "userId": access["callerSub"],
      "username": access["username"],
      "projectId": access["projectId"],
      "projectName": project.get("projectName") or access["projectId"],
      "piName": project.get("piName") or "",
      "adminName": project.get("adminName") or "",
      "fileKey": file_key,
      "fileName": file_name,
      "contentType": content_type,
      "status": "pending",
      "createdAt": created_at,
      "updatedAt": created_at,
    }
    item.update(build_upload_gsi_keys(access["callerSub"], created_at, upload_pk))
    table.put_item(Item=item)
    update_subject_last_upload(access["projectId"], access.get("subjectId"), created_at)

    return response(
      200,
      {
        "uploadUrl": presigned_url,
        "fileKey": file_key,
        "uploadId": upload_id,
        "expiresIn": UPLOAD_URL_TTL_SECONDS,
      },
    )
  except PermissionError as exc:
    return error_response(401, str(exc))
  except ValueError as exc:
    return error_response(400, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
