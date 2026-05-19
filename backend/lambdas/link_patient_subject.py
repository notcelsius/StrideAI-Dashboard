from common import error_response, get_subject_record, iso_now, options_response, parse_body, resolve_access_context, response, table


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    access = resolve_access_context(event)
    if access["role"] not in {"admin", "coordinator"}:
      return error_response(403, "Forbidden: only staff can link patient subjects")

    body = parse_body(event)
    patient_sub = body.get("patientSub")
    subject_id = body.get("subjectId")
    project_id = body.get("projectId") or access.get("projectId")
    if not patient_sub or not subject_id or not project_id:
      return error_response(400, "patientSub, subjectId, and projectId are required")

    subject = get_subject_record(project_id, subject_id)
    if not subject:
      return error_response(404, "Subject not found")

    updated_at = iso_now()
    table.update_item(
      Key={"pk": f"PROJECT#{project_id}", "sk": f"SUBJECT#{subject_id}"},
      UpdateExpression="SET userSub = :user_sub, updatedAt = :updated_at",
      ExpressionAttributeValues={
        ":user_sub": patient_sub,
        ":updated_at": updated_at,
      },
    )
    table.update_item(
      Key={"pk": f"USER#{patient_sub}", "sk": "PROFILE"},
      UpdateExpression="SET projectId = :project_id, updatedAt = :updated_at",
      ExpressionAttributeValues={
        ":project_id": project_id,
        ":updated_at": updated_at,
      },
    )

    return response(
      200,
      {
        "patientSub": patient_sub,
        "subjectId": subject_id,
        "projectId": project_id,
      },
    )
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
