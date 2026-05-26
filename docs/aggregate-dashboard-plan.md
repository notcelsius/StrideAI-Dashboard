# Aggregate Dashboard + Precomputed Backend Plan

## Summary
Build aggregate participant views as a first-class backend feature, not a per-request scan. Use nightly batch jobs to precompute daily aggregate rows in DynamoDB, expose a filterable stats API, and update the dashboard page to show cross-study/group metrics with sortable participant rankings.

## Backend + Data Model
- Store aggregate rows in the existing `StrideAI` table using deterministic daily keys:
  - `pk = AGG#ALL`
  - `pk = AGG#PROJECT#<projectId>`
  - `pk = AGG#GROUP#<groupId>`
  - `pk = AGG#PROJECT#<projectId>#GROUP#<groupId>`
  - `sk = DAY#<YYYY-MM-DD>` for daily totals
  - `sk = DAY#<YYYY-MM-DD>#SUBJECT#<subjectId>` for participant daily ranking rows
- Aggregate rows include miles, distance meters, session count, active participant count, linked participant count, project/group metadata, and subject metadata for participant rows.
- Add/finish subject group support:
  - subject records carry `groups`, `groupIds`, `groupId`, `groupName`
  - admin can assign/replace/add/remove/clear groups for one or more subjects
  - new route: `POST /admin/subject-groups`
- Add nightly rebuild Lambda:
  - default rebuild window: last 90 days
  - accepts explicit `start`/`end` for one-off backfills
  - deletes existing aggregate rows in the target date window before rewriting them, so group changes and stale rows are corrected
  - EventBridge schedule: nightly
- Run one-time AWS backfill during rollout for existing data.

## API Changes
- Add `GET /participants/statistics`
  - required: `start`, `end`
  - optional: `projectId/projectIds`, `studyId/studyIds`, `groupId/groupIds`, `sortBy`, `sortDir`
  - default view is all accessible studies
  - group filters are OR filters; participant-day rows are de-duped by `projectId + subjectId + date`
  - sortable v1 fields: `totalMiles`, `averageMilesPerActiveDay`, `activeDays`, `sessionCount`
- Response includes:
  - `aggregate` KPIs
  - `dailyTotals` for charts
  - `byStudy`
  - `byGroup`
  - `participants` sorted according to query params
  - `filters` echoing the active filter state
- Update existing subject miles/export APIs to accept `projectId` when needed so duplicate `subjectId`s across studies are safe.

## Frontend
- Update `/dashboard` from a single-project roster page into the main aggregate dashboard:
  - default admin view: all studies overview
  - date range controls
  - study filter
  - group filter
  - KPI cards: participants, linked participants, total miles, avg daily miles, active days/sessions
  - daily miles chart using `dailyTotals`
  - sortable participant table for miles/session metrics
- Keep the subject roster available inside the dashboard as the participant table/drilldown path.
- Update subject links to include project context where needed.
- Update admin page:
  - show subject group columns
  - allow group entry during subject creation
  - add bulk group assignment form for selected subjects.

## AWS Rollout
- Package and deploy updated Lambda code.
- Create new Lambda functions:
  - `StrideAI-get_participant_statistics`
  - `StrideAI-update_subject_groups`
  - `StrideAI-rebuild_aggregate_statistics`
- Wire API Gateway routes:
  - `GET /participants/statistics`
  - `POST /admin/subject-groups`
- Add Lambda permission for API Gateway routes.
- Add EventBridge nightly schedule for rebuild Lambda.
- Run one-time backfill with explicit historical range after deploy.
- Do not deploy current local draft as-is; adjust it to use precomputed aggregate rows first.

## Test Plan
- Backend:
  - `python3 -m py_compile backend/lambdas/*.py`
  - local mocked Lambda invocation for group assignment
  - local mocked rebuild over sample subjects/daily metrics
  - verify stale aggregate rows are removed during rebuild
  - verify multi-group subjects are included in each group aggregate
  - verify group multi-select de-dupes participant-day rows
- AWS:
  - invoke rebuild Lambda on a small date range
  - query DynamoDB aggregate rows for `AGG#ALL`, project, group, and project+group keys
  - call `GET /participants/statistics` with all-studies, study-only, group-only, and study+group filters
- Frontend:
  - dashboard loads all-studies overview by default
  - date/study/group filters refresh stats
  - participant table sorts by total miles, average daily miles, active days, and session count
  - admin can assign groups and see dashboard filters reflect them after rebuild/backfill.

## Assumptions
- Nightly freshness is acceptable for v1.
- Daily aggregate rows are the canonical performance layer.
- Default scheduled rebuild window is last 90 days.
- Historical data is populated through one-time backfill.
- "Study" maps to current `projectId`/project metadata.
