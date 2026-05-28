# Aggregate Dashboard — Frontend & Execution Plan

Companion to `aggregate-dashboard-plan.md`. That doc is canonical for backend data model, API surface, and AWS rollout. This doc covers execution: phasing, UX, role behavior, and the loose ends needed to actually build.

## 1. Phasing

**Decision (proposed): v1 ships on-demand. Precompute is v2.**

The original plan said "do not deploy current local draft as-is; adjust to use precomputed aggregate rows first." That was written before `get_participant_statistics.py` existed in its current form. With it in place — and with subject counts still modest — the on-demand path is good enough to ship the dashboard now and gather usage signal before investing in precompute.

### v1 — On-demand (ship now)
- Deploy existing `get_participant_statistics` Lambda + API Gateway route.
- Deploy `update_subject_groups` Lambda + route.
- Add `sortBy`/`sortDir` to `get_participant_statistics` (small).
- Build frontend dashboard rework against the on-demand endpoint.
- Add admin group-assignment UI.

### v2 — Precompute (defer)
- Trigger: any of —
  - p95 of `GET /participants/statistics` > 3s, OR
  - any single project > 200 subjects, OR
  - any all-studies query > 800 participant-days in range.
- Build `AGG#` row writer + nightly rebuild Lambda + EventBridge schedule + one-time backfill, per existing plan.
- Switch reader to prefer AGG# rows when available, fall back to on-demand otherwise.

Naming a concrete trigger keeps precompute from becoming a perpetual "next sprint."

## 2. Route Migration

**Decision (proposed): Option A — `/dashboard` becomes the aggregate view; per-project = aggregate with a project filter pre-applied.**

- `/dashboard` (default): all accessible studies, last 14 days.
- `/dashboard?projectId=<id>`: same view, project filter prefilled. Per-project bookmarks keep working.
- `/dashboard?projectId=<id>&groupId=<id>`: project + group filter prefilled.
- `/dashboard/subject/<subjectId>` (existing): unchanged drilldown.
- `/dashboard/admin` (existing): unchanged management page.

Filter state lives in the URL so links are shareable. No new top-level routes.

Rationale vs. Option B (separate `/dashboard/project/<id>` roster page): one less view to maintain, and the "roster" is just `participants[]` from the same endpoint with a project filter — duplicating it would create two sources of truth.

## 3. Dashboard Layout

```
┌──────────────────────────────────────────────────────┐
│ Header (signed-in user, role, Manage, Logout)        │
├──────────────────────────────────────────────────────┤
│ Filter bar:                                          │
│   [Start date]  [End date]   [Study ▾]  [Group ▾]    │
│   [Reset]                          Refreshed: <time> │
├──────────────────────────────────────────────────────┤
│ KPI row (5 cards):                                   │
│   Participants │ Linked │ Total mi │ Avg/day │ Sess  │
├──────────────────────────────────────────────────────┤
│ Daily miles chart (dailyTotals)                      │
├──────────────────────────────────────────────────────┤
│ Participants table (sortable columns)                │
│   Subject │ Name │ Study │ Group │ Miles │ Active │  │
│   Avg/active day │ Sessions                          │
└──────────────────────────────────────────────────────┘
```

- Default date range: last 14 days (matches existing `getDefaultDateRange()`).
- Date range cap (v1): 90 days. Prevents accidental scans. Surfaced in the UI as a hint, not a silent clamp.
- "Refreshed: <time>" badge: shows `Date.now()` in v1; switches to last `AGG#` rebuild timestamp in v2.

### KPI cards (in order)
1. Participants (`aggregate.participantCount`)
2. Linked (`aggregate.linkedParticipantCount`)
3. Total miles (`aggregate.totalMiles`)
4. Avg miles / active day (`aggregate.averageMilesPerActiveDay`)
5. Sessions (`aggregate.totalSessionCount`)

### Participants table — sort spec
- Sortable columns: `totalMiles`, `averageMilesPerActiveDay`, `activeDays`, `sessionCount`. Matches API v1 fields.
- Default sort: `totalMiles desc`.
- Click header to toggle `asc` ↔ `desc`. Clicking a different column resets direction to `desc`.
- Tie-breaker (server-side): `projectName asc, subjectId asc`.
- Sort state persists in URL: `?sortBy=totalMiles&sortDir=desc`.
- Non-sortable columns (Subject, Name, Study, Group): plain headers, no affordance.

### Empty / loading states
- No participants in range → "No participants matched these filters."
- No project access → "No project access has been assigned to your account yet."
- Loading → spinner row in table, KPI cards show "—".
- Error → existing `.error-text` style.

## 4. Group Management UX

The plan said "add bulk group assignment form for selected subjects" — that's the whole frontend spec. Filling it in:

### Group model
- Groups are **per-project** and **ad-hoc** (created on first assignment, not pre-registered).
- `groupId` is namespaced: `<projectId>:<slug>` so cross-project names don't collide.
- `groupName` is human-readable, editable.
- A subject can belong to **multiple groups** (existing backend supports `groups[]`).
- Reserved: `ungrouped` (synthetic, computed by the lambda — never written).

### Admin page changes (`/dashboard/admin`)
- New column in the subjects table: **Groups** (chip list, e.g. `cohort-a · responders`).
- Row selection: checkbox per row + "select all on page" header checkbox.
- Bulk action bar (appears when ≥1 selected): `Assign group ▾` / `Remove group ▾` / `Clear groups`.
  - Assign: typeahead input — pick existing group in this project or type a new name (creates on submit).
  - Remove: select from current groups of the selected subjects.
- Single-row edit: per-row "Edit groups" link opens a small modal with the same controls scoped to that subject.
- On any change → `POST /admin/subject-groups` → optimistic UI update + refetch project subjects.

### Subject creation
- Subject creation form gains optional "Groups" multi-input (chips). Empty = ungrouped.

### Filter bar group dropdown (`/dashboard`)
- Lists all groups across the user's accessible projects, grouped by project.
- "Ungrouped" appears as a synthetic option (drives the `groupId=ungrouped` filter).
- Single-select for v1 (lambda accepts multi-select via CSV; we can add multi-select UI later if needed).

## 5. Role Behavior

**Important:** the dashboard app is wired to the **staff Cognito user pool only**. Patient users authenticate against a separate pool used by the patient app and cannot complete the OAuth flow here. No patient-facing handling is needed on `/dashboard`.

| Role | `/dashboard` view | Filters they can apply | Notes |
|---|---|---|---|
| `admin` | All studies, all groups | Any project, any group | Default view of the page. |
| `pi` | Their projects only | Their projects, any group within them | Lambda already filters via `list_accessible_projects`. |
| `coordinator` | Same as PI | Same as PI | |
| `user` (fallback) | Empty state | n/a | No project access — render "No project access has been assigned to your account yet." |

The `role === "patient"` branch in `get_participant_statistics.py:191` stays as defensive code (correctly filters by `callerSub` if a patient token ever reached this endpoint), but no frontend patient handling is added.

## 6. Backend Changes Required for v1

All in `get_participant_statistics.py`:

1. **Sort handling.** Read `sortBy` / `sortDir` query params. Validate `sortBy ∈ {totalMiles, averageMilesPerActiveDay, activeDays, sessionCount}`; default `totalMiles`. Validate `sortDir ∈ {asc, desc}`; default `desc`. Apply to `participants[]` before returning. Tie-break by `projectName asc, subjectId asc`.
2. **Date range cap.** Reject ranges > 90 days with a 400. Matches the frontend cap; keeps abuse cheap.
3. **Skip inactive subjects.** Before calling `query_daily_metrics(linked_sub, start_date, end_date)`, check the subject's `lastUploadAt`. If present and strictly before `start_date`, treat the subject as having no metrics in the window (skip the DDB query, contribute zero to all metric totals). Subject still counts toward `participantCount` / `linkedParticipantCount`. Saves one DDB query per inactive subject per view.

No new lambdas needed for v1. `update_subject_groups.py` already exists.

## 7. Frontend Changes Required for v1

### `lib/dashboardApi.js`
- Add `getParticipantStatistics(session, params)` — wraps `GET /participants/statistics` with `start`, `end`, `projectIds`, `groupIds`, `sortBy`, `sortDir`. **No client-side cache** — the payload contains per-participant rows (subjectId, participantName, userSub, group membership, activity metrics), which is PHI-adjacent research data. Persisting it in `localStorage` / `sessionStorage` would expand XSS blast radius and leave data on shared devices after logout. In-memory cache barely helped (only React re-renders and back-nav) so we drop it. Lambda is cheap; skip-inactive-subjects (§6) does the cost work.
- Add `updateSubjectGroups(session, { subjectIds, projectId, add, remove, replace, clear })` — wraps `POST /admin/subject-groups`.

### `app/dashboard/page.js`
- Replace the project-roster view with the aggregate dashboard described in §3.
- URL state via `useSearchParams` / `router.replace`.
- No patient handling needed — staff pool only (§5).

### `app/dashboard/admin/page.js`
- Add Groups column, row selection, bulk action bar per §4.
- Subject creation form gains a Groups input.

### `app/globals.css`
- Reuse existing `.kpi-card`, `.panel`, `.table-wrap`, the new global `select` style.
- Add: sortable column header style (chevron indicator), chip style, bulk action bar.

## 8. AWS Rollout (v1)

- Deploy updated `get_participant_statistics` Lambda (sort + 90-day cap).
- Create `update_subject_groups` Lambda if not already created.
- API Gateway routes:
  - `GET /participants/statistics`
  - `POST /admin/subject-groups`
- Add Lambda permissions for API Gateway routes.
- Skip EventBridge / backfill / AGG# row writes — those are v2.

## 9. Test Plan (frontend)

- `/dashboard` loads all-studies view by default with correct date range.
- Changing date range refetches and updates KPI cards, chart, and table.
- Study filter and group filter refetch correctly.
- Sortable headers toggle `asc`/`desc`, persist in URL, server returns matching order.
- URL filter params survive page reload.
- Patient role lands on subject detail, never sees aggregate.
- PI without admin access sees only their projects in filters and results.
- Empty filters / empty results / loading / error states all render correctly.
- Admin: bulk-assign group to N selected subjects updates the table immediately and after refetch.
- Admin: subject creation with groups carries groups through to `getProjectSubjects` response.

## 10. Out of Scope (v1)

- Precomputed `AGG#` rows / nightly rebuild Lambda / EventBridge / backfill.
- Multi-select for the dashboard group filter.
- Export aggregate stats to CSV.
- Per-user saved filter presets.
- Real-time refresh / websocket.
- Mobile-optimized layout (keep current responsive behavior; no new work).

## 11. Decisions Locked In

- [x] **v1 = on-demand; v2 deferred entirely** (§1). v2 will be planned separately when a trigger condition fires.
- [x] **Option A routing** (§2): `/dashboard` is aggregate; `?projectId=<id>` prefills the project filter.
- [x] **90-day range cap** (§3, §6).
- [x] **Group model**: per-project, ad-hoc (created on first assignment), multi-group, namespaced `<projectId>:<slug>` (§4).
- [x] **Staff-only dashboard** (§5): no patient handling. Patients use the separate patient pool / patient app.
- [x] **Cost levers in v1**: skip-inactive-subjects in the lambda (§6). Client-side response caching was considered and rejected — PHI-adjacent payloads should not be persisted in browser storage. Server-side caching deferred to v2 along with precompute.
