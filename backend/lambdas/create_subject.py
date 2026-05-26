from common import (
    error_response,
    get_subject_record,
    iso_now,
    normalize_subject_groups,
    options_response,
    parse_body,
    require_project_access,
    require_staff_role,
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
        require_staff_role(access)

        body = parse_body(event)
        subject_id = (body.get("subjectId") or "").strip()
        project_id = body.get("projectId") or access.get("projectId")
        participant_name = (body.get("participantName") or "").strip()
        groups = normalize_subject_groups(
            body.get("groups"),
            body.get("groupId"),
            body.get("groupName"),
        )

        if not subject_id or not project_id:
            return error_response(400, "subjectId and projectId are required")

        require_project_access(access, project_id)

        existing = get_subject_record(project_id, subject_id)
        if existing:
            return error_response(409, "Subject already exists in this project")

        now = iso_now()
        item = {
            "pk": f"PROJECT#{project_id}",
            "sk": f"SUBJECT#{subject_id}",
            "entityType": "SUBJECT",
            "subjectId": subject_id,
            "projectId": project_id,
            "participantName": participant_name,
            "status": "active",
            "createdBy": access["callerSub"],
            "createdAt": now,
            "groups": groups,
            "groupIds": [group["groupId"] for group in groups],
            "groupNames": [group["groupName"] for group in groups],
        }
        if groups:
            item["groupId"] = groups[0]["groupId"]
            item["groupName"] = groups[0]["groupName"]
        table.put_item(Item=item)

        return response(201, {
            "subjectId": subject_id,
            "projectId": project_id,
            "participantName": participant_name,
            "status": "active",
            "groups": groups,
            "groupIds": [group["groupId"] for group in groups],
        })
    except ValueError as exc:
        return error_response(400, str(exc))
    except PermissionError as exc:
        return error_response(403, str(exc))
    except Exception as exc:
        return error_response(500, "Internal server error", str(exc))
