import re

from botocore.exceptions import ClientError

from common import (
    error_response,
    iso_now,
    options_response,
    parse_body,
    project_payload,
    require_admin_role,
    resolve_access_context,
    response,
    table,
)


PROJECT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def validate_project_id(project_id):
    if not project_id:
        raise ValueError("projectId is required")
    if not PROJECT_ID_PATTERN.match(project_id):
        raise ValueError("projectId may contain only letters, numbers, underscores, and hyphens")
    return project_id


def lambda_handler(event, context):
    try:
        method = (event.get("httpMethod") or "").upper()
        if method == "OPTIONS":
            return options_response()

        access = resolve_access_context(event)
        require_admin_role(access)

        body = parse_body(event)
        project_id = validate_project_id(str(body.get("projectId") or "").strip())
        project_name = str(body.get("projectName") or "").strip()
        pi_name = str(body.get("piName") or "").strip()
        admin_name = str(body.get("adminName") or "").strip()

        if not project_name:
            return error_response(400, "projectName is required")

        now = iso_now()
        item = {
            "pk": f"PROJECT#{project_id}",
            "sk": "METADATA",
            "entityType": "PROJECT",
            "projectId": project_id,
            "projectName": project_name,
            "piName": pi_name,
            "adminName": admin_name,
            "createdBy": access["callerSub"],
            "createdAt": now,
            "updatedAt": now,
        }

        try:
            table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(pk)",
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return error_response(409, "Project already exists")
            raise

        return response(201, project_payload(item))
    except ValueError as exc:
        return error_response(400, str(exc))
    except PermissionError as exc:
        return error_response(403, str(exc))
    except Exception as exc:
        return error_response(500, "Internal server error", str(exc))
