from common import (
  error_response,
  normalize_location_entry,
  options_response,
  parse_body,
  resolve_access_context,
  response,
  serialize_location,
  upsert_location,
)


def lambda_handler(event, context):
  """POST /locations — upsert the caller's named-location labels.

  The user is derived from the JWT (same as every other write), so the body
  never carries a userSub. Accepts either a bare JSON array of label objects or
  `{ "locations": [...] }`. Each entry tolerates the additive rollout shapes:
  with or without `id`/`deleted` (see NAMED_LOCATIONS_HANDOFF.md). Renames and
  deletes are idempotent because the upsert is keyed on the locationId.
  """
  try:
    method = (
      event.get("requestContext", {}).get("http", {}).get("method")
      or event.get("httpMethod")
      or ""
    ).upper()
    if method == "OPTIONS":
      return options_response()

    access = resolve_access_context(event)
    user_sub = access["callerSub"]

    body = parse_body(event)
    raw_locations = body if isinstance(body, list) else body.get("locations")
    if not isinstance(raw_locations, list) or not raw_locations:
      return error_response(
        400, "Request body must be a non-empty array of locations (or { \"locations\": [...] })"
      )

    upserted = []
    deleted_count = 0
    for raw in raw_locations:
      entry = normalize_location_entry(raw)
      item = upsert_location(user_sub, entry)
      if entry["deleted"]:
        deleted_count += 1
      else:
        upserted.append(serialize_location(item))

    return response(
      200,
      {
        "ok": True,
        "userId": user_sub,
        "upsertedCount": len(upserted),
        "deletedCount": deleted_count,
        "locations": upserted,
      },
    )
  except PermissionError as exc:
    return error_response(401, str(exc))
  except ValueError as exc:
    return error_response(400, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
