from common import (
    error_response,
    options_response,
    query_project_subjects,
    resolve_access_context,
    response,
)


def lambda_handler(event, context):
    try:
        method = (event.get("httpMethod") or "").upper()
        if method == "OPTIONS":
            return options_response()

        access = resolve_access_context(event)
        profile = access.get("profile")
        if not profile or not access.get("projectId"):
            return error_response(404, "No enrollment profile found")

        project_id = access["projectId"]
        caller_sub = access["callerSub"]
        subject_id = profile.get("subjectId") or ""

        participant_name = ""

        if not subject_id:
            subjects = query_project_subjects(project_id)
            linked = next(
                (s for s in subjects if s.get("userSub") == caller_sub), None
            )
            if linked:
                subject_id = linked.get("subjectId", "")
                participant_name = linked.get("participantName", "")

        if not participant_name:
            participant_name = (
                profile.get("participantName")
                or profile.get("username")
                or subject_id
                or caller_sub
            )

        return response(200, {
            "projectId": project_id,
            "subjectId": subject_id,
            "participantName": participant_name,
            "username": access["username"],
        })
    except PermissionError as exc:
        return error_response(401, str(exc))
    except Exception as exc:
        return error_response(500, "Internal server error", str(exc))
