import secrets

from common import (
    error_response,
    get_item,
    get_subject_record,
    iso_now,
    options_response,
    parse_body,
    require_project_access,
    require_staff_role,
    resolve_access_context,
    response,
    table,
)


def generate_code():
    return secrets.token_hex(4).upper()


def lambda_handler(event, context):
    try:
        method = (event.get("httpMethod") or "").upper()
        if method == "OPTIONS":
            return options_response()

        access = resolve_access_context(event)
        require_staff_role(access)

        body = parse_body(event)
        subject_id = body.get("subjectId")
        project_id = body.get("projectId") or access.get("projectId")
        participant_name = body.get("participantName", "")

        if not subject_id or not project_id:
            return error_response(400, "subjectId and projectId are required")

        require_project_access(access, project_id)

        subject = get_subject_record(project_id, subject_id)
        if not subject:
            return error_response(404, "Subject not found in project")

        if subject.get("userSub"):
            return error_response(409, "Subject already has a linked patient")

        code = generate_code()
        while get_item(f"ENROLLMENT#{code}", "META"):
            code = generate_code()

        now = iso_now()
        table.put_item(Item={
            "pk": f"ENROLLMENT#{code}",
            "sk": "META",
            "entityType": "ENROLLMENT_CODE",
            "code": code,
            "projectId": project_id,
            "subjectId": subject_id,
            "participantName": participant_name or subject.get("participantName") or subject_id,
            "status": "active",
            "createdBy": access["callerSub"],
            "createdAt": now,
        })

        return response(200, {
            "code": code,
            "projectId": project_id,
            "subjectId": subject_id,
            "participantName": participant_name or subject.get("participantName") or subject_id,
        })
    except PermissionError as exc:
        return error_response(403, str(exc))
    except Exception as exc:
        return error_response(500, "Internal server error", str(exc))
