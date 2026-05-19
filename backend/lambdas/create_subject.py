from common import (
    error_response,
    get_subject_record,
    iso_now,
    options_response,
    parse_body,
    require_project_access,
    resolve_access_context,
    response,
    table,
)


def lambda_handler(event, context):
    try:
        method = (event.get("httpMethod") or "").upper()
        if method == "OPTIONS":
            return options_response()

        access = resolve_access_context(event)
        if access["role"] not in {"admin", "coordinator"}:
            return error_response(403, "Forbidden: only staff can create subjects")

        body = parse_body(event)
        subject_id = (body.get("subjectId") or "").strip()
        project_id = body.get("projectId") or access.get("projectId")
        participant_name = (body.get("participantName") or "").strip()

        if not subject_id or not project_id:
            return error_response(400, "subjectId and projectId are required")

        require_project_access(access, project_id)

        existing = get_subject_record(project_id, subject_id)
        if existing:
            return error_response(409, "Subject already exists in this project")

        now = iso_now()
        table.put_item(Item={
            "pk": f"PROJECT#{project_id}",
            "sk": f"SUBJECT#{subject_id}",
            "entityType": "SUBJECT",
            "subjectId": subject_id,
            "projectId": project_id,
            "participantName": participant_name,
            "status": "active",
            "createdBy": access["callerSub"],
            "createdAt": now,
        })

        return response(201, {
            "subjectId": subject_id,
            "projectId": project_id,
            "participantName": participant_name,
            "status": "active",
        })
    except PermissionError as exc:
        return error_response(403, str(exc))
    except Exception as exc:
        return error_response(500, "Internal server error", str(exc))
