from common import (
  error_response,
  get_query_param,
  list_accessible_projects,
  options_response,
  parse_csv_list,
  parse_iso_date,
  project_payload,
  query_daily_metrics,
  query_project_subjects,
  resolve_access_context,
  response,
  serialize_subject,
  is_staff_role,
  subject_groups,
  subject_matches_group_filter,
)


UNGROUPED = {"groupId": "ungrouped", "groupName": "Ungrouped"}


def bool_query(value):
  return str(value or "").strip().lower() in {"1", "true", "yes", "y"}


def metric_float(row, key):
  return float(row.get(key, 0) or 0)


def metric_int(row, key):
  return int(row.get(key, 0) or 0)


def empty_bucket():
  return {
    "participantCount": 0,
    "linkedParticipantCount": 0,
    "participantsWithMetrics": 0,
    "totalMiles": 0,
    "totalDistanceMeters": 0,
    "totalSessionCount": 0,
    "_activeDates": set(),
  }


def add_participant_to_bucket(bucket, linked, has_metrics):
  bucket["participantCount"] += 1
  if linked:
    bucket["linkedParticipantCount"] += 1
  if has_metrics:
    bucket["participantsWithMetrics"] += 1


def add_metrics_to_bucket(bucket, daily_stats):
  for row in daily_stats:
    bucket["totalMiles"] += row["miles"]
    bucket["totalDistanceMeters"] += row["distanceMeters"]
    bucket["totalSessionCount"] += row["sessionCount"]
    bucket["_activeDates"].add(row["date"])


def finalize_bucket(bucket, calendar_days):
  participant_count = bucket["participantCount"]
  linked_count = bucket["linkedParticipantCount"]
  active_count = bucket["participantsWithMetrics"]
  active_days = len(bucket["_activeDates"])
  total_miles = round(bucket["totalMiles"], 2)
  total_distance = round(bucket["totalDistanceMeters"], 2)
  return {
    "participantCount": participant_count,
    "linkedParticipantCount": linked_count,
    "unlinkedParticipantCount": max(participant_count - linked_count, 0),
    "participantsWithMetrics": active_count,
    "totalMiles": total_miles,
    "totalDistanceMeters": total_distance,
    "totalSessionCount": int(bucket["totalSessionCount"]),
    "activeDays": active_days,
    "averageMilesPerParticipant": round(total_miles / participant_count, 2) if participant_count else 0,
    "averageMilesPerLinkedParticipant": round(total_miles / linked_count, 2) if linked_count else 0,
    "averageMilesPerActiveParticipant": round(total_miles / active_count, 2) if active_count else 0,
    "averageMilesPerActiveDay": round(total_miles / active_days, 2) if active_days else 0,
    "averageMilesPerCalendarDay": round(total_miles / calendar_days, 2) if calendar_days else 0,
  }


def build_daily_stats(metrics):
  return [
    {
      "date": row.get("date"),
      "miles": round(metric_float(row, "miles"), 2),
      "distanceMeters": round(metric_float(row, "distanceMeters"), 2),
      "sessionCount": metric_int(row, "sessionCount"),
    }
    for row in metrics
  ]


def update_daily_totals(daily_totals, daily_stats, subject_id):
  for row in daily_stats:
    date = row["date"]
    bucket = daily_totals.setdefault(
      date,
      {
        "date": date,
        "miles": 0,
        "distanceMeters": 0,
        "sessionCount": 0,
        "_subjectIds": set(),
      },
    )
    bucket["miles"] += row["miles"]
    bucket["distanceMeters"] += row["distanceMeters"]
    bucket["sessionCount"] += row["sessionCount"]
    bucket["_subjectIds"].add(subject_id)


def finalize_daily_totals(daily_totals):
  finalized = []
  for date in sorted(daily_totals.keys()):
    row = daily_totals[date]
    finalized.append(
      {
        "date": date,
        "miles": round(row["miles"], 2),
        "distanceMeters": round(row["distanceMeters"], 2),
        "sessionCount": int(row["sessionCount"]),
        "participantCount": len(row["_subjectIds"]),
      }
    )
  return finalized


def get_project_filters(event):
  project_filters = []
  for key in ["projectId", "projectIds", "studyId", "studyIds"]:
    project_filters.extend(parse_csv_list(get_query_param(event, key)))
  deduped = []
  seen = set()
  for project_id in project_filters:
    if project_id in seen:
      continue
    seen.add(project_id)
    deduped.append(project_id)
  return deduped


def lambda_handler(event, context):
  try:
    method = (event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
      return options_response()

    start_date = get_query_param(event, "start")
    end_date = get_query_param(event, "end")
    if not start_date or not end_date:
      return error_response(400, "start and end query params are required")

    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    if start > end:
      return error_response(400, "start must be before or equal to end")

    calendar_days = (end - start).days + 1
    project_filters = get_project_filters(event)
    group_filters = parse_csv_list(get_query_param(event, "groupId")) + parse_csv_list(get_query_param(event, "groupIds"))
    subject_filters = parse_csv_list(get_query_param(event, "subjectId")) + parse_csv_list(get_query_param(event, "subjectIds"))
    include_daily = bool_query(get_query_param(event, "includeDaily"))

    access = resolve_access_context(event)
    projects = list_accessible_projects(access, project_filters)

    subject_filter_set = {subject_id.lower() for subject_id in subject_filters}
    aggregate_bucket = empty_bucket()
    study_buckets = {}
    group_buckets = {}
    participants = []
    daily_totals = {}

    for project in projects:
      project_info = project_payload(project)
      project_id = project_info["projectId"]
      study_bucket = study_buckets.setdefault(project_id, {"project": project_info, "totals": empty_bucket()})

      for subject in query_project_subjects(project_id):
        subject_id = subject.get("subjectId") or ""
        if subject_filter_set and subject_id.lower() not in subject_filter_set:
          continue
        if not subject_matches_group_filter(subject, group_filters):
          continue
        if access["role"] == "patient" and subject.get("userSub") != access["callerSub"]:
          continue

        linked_sub = subject.get("userSub") or ""
        metrics = query_daily_metrics(linked_sub, start_date, end_date) if linked_sub else []
        daily_stats = build_daily_stats(metrics)
        has_metrics = bool(daily_stats)
        linked = bool(linked_sub)

        add_participant_to_bucket(aggregate_bucket, linked, has_metrics)
        add_metrics_to_bucket(aggregate_bucket, daily_stats)
        add_participant_to_bucket(study_bucket["totals"], linked, has_metrics)
        add_metrics_to_bucket(study_bucket["totals"], daily_stats)

        groups = subject_groups(subject) or [UNGROUPED]
        for group in groups:
          group_bucket = group_buckets.setdefault(group["groupId"], {"group": group, "totals": empty_bucket()})
          add_participant_to_bucket(group_bucket["totals"], linked, has_metrics)
          add_metrics_to_bucket(group_bucket["totals"], daily_stats)

        update_daily_totals(daily_totals, daily_stats, subject_id)

        total_miles = round(sum(row["miles"] for row in daily_stats), 2)
        total_distance = round(sum(row["distanceMeters"] for row in daily_stats), 2)
        total_sessions = sum(row["sessionCount"] for row in daily_stats)
        participant = {
          **serialize_subject(subject, include_user_sub=is_staff_role(access["role"])),
          "projectId": project_id,
          "projectName": project_info["projectName"],
          "linked": linked,
          "metrics": {
            "totalMiles": total_miles,
            "totalDistanceMeters": round(total_distance, 2),
            "totalSessionCount": int(total_sessions),
            "activeDays": len(daily_stats),
            "averageMilesPerActiveDay": round(total_miles / len(daily_stats), 2) if daily_stats else 0,
            "averageMilesPerCalendarDay": round(total_miles / calendar_days, 2) if calendar_days else 0,
          },
        }
        if include_daily:
          participant["dailyStats"] = daily_stats
        participants.append(participant)

    by_study = []
    for project_id in sorted(study_buckets.keys()):
      bucket = study_buckets[project_id]
      by_study.append({**bucket["project"], **finalize_bucket(bucket["totals"], calendar_days)})

    by_group = []
    for group_id in sorted(group_buckets.keys()):
      bucket = group_buckets[group_id]
      by_group.append({**bucket["group"], **finalize_bucket(bucket["totals"], calendar_days)})

    participants.sort(key=lambda item: (item.get("projectName", ""), item.get("subjectId", "")))

    return response(
      200,
      {
        "range": {"start": start_date, "end": end_date},
        "filters": {
          "projectIds": project_filters,
          "studyIds": project_filters,
          "groupIds": group_filters,
          "subjectIds": subject_filters,
        },
        "aggregate": finalize_bucket(aggregate_bucket, calendar_days),
        "dailyTotals": finalize_daily_totals(daily_totals),
        "byStudy": by_study,
        "byGroup": by_group,
        "participants": participants,
      },
    )
  except PermissionError as exc:
    return error_response(403, str(exc))
  except ValueError as exc:
    return error_response(400, str(exc))
  except Exception as exc:
    return error_response(500, "Internal server error", str(exc))
