from common import (
    error_response,
    extract_cognito_sub,
    get_item,
    iso_now,
    options_response,
    parse_body,
    response,
    table,
)


def lambda_handler(event, context):
    try:
        method = (event.get("httpMethod") or "").upper()
        if method == "OPTIONS":
            return options_response()

        caller_sub = extract_cognito_sub(event)
        if not caller_sub:
            return error_response(401, "Unauthorized: could not resolve user identity")

        body = parse_body(event)
        code = (body.get("code") or "").strip().upper()
        if not code:
            return error_response(400, "code is required")

        enrollment = get_item(f"ENROLLMENT#{code}", "META")
        if not enrollment:
            return error_response(404, "Invalid enrollment code")

        if enrollment.get("status") != "active":
            return error_response(410, "Enrollment code has already been used")

        project_id = enrollment["projectId"]
        subject_id = enrollment["subjectId"]
        participant_name = enrollment.get("participantName", "")

        existing_profile = get_item(f"USER#{caller_sub}", "PROFILE")
        if existing_profile and existing_profile.get("projectId"):
            return error_response(409, "This account is already enrolled in a project")

        subject = get_item(f"PROJECT#{project_id}", f"SUBJECT#{subject_id}")
        if not subject:
            return error_response(404, "Subject record not found")
        if subject.get("userSub") and subject["userSub"] != caller_sub:
            return error_response(409, "Subject is already linked to another patient")

        now = iso_now()

        table.put_item(Item={
            "pk": f"USER#{caller_sub}",
            "sk": "PROFILE",
            "projectId": project_id,
            "subjectId": subject_id,
            "participantName": participant_name or subject_id,
            "username": participant_name or caller_sub,
            "enrolledAt": now,
            "enrollmentCode": code,
            "updatedAt": now,
        })

        table.update_item(
            Key={"pk": f"PROJECT#{project_id}", "sk": f"SUBJECT#{subject_id}"},
            UpdateExpression="SET userSub = :sub, updatedAt = :ts",
            ExpressionAttributeValues={":sub": caller_sub, ":ts": now},
        )

        table.update_item(
            Key={"pk": f"ENROLLMENT#{code}", "sk": "META"},
            UpdateExpression="SET #s = :used, redeemedBy = :sub, redeemedAt = :ts",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":used": "used",
                ":sub": caller_sub,
                ":ts": now,
            },
        )

        return response(200, {
            "enrolled": True,
            "projectId": project_id,
            "subjectId": subject_id,
            "participantName": participant_name or subject_id,
        })
    except Exception as exc:
        return error_response(500, "Internal server error", str(exc))
