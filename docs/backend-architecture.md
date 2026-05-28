# StrideAI Backend Architecture

## Overview
The dashboard uses Cognito for authentication, DynamoDB for metadata and authorization lookups, and S3 for CSV blob storage. Daily miles remain the source of truth for analytics. Uploaded CSV files are opaque in v1 and are returned through presigned download URLs.

For the end-to-end identity, project, PI/admin, participant enrollment, and upload flow, see [Backend Data Flow](./backend-data-flow.md).

## Architecture
```text
[Cognito User]
      |
      v
[Next.js Dashboard]
      |
      | Authorization: Bearer <JWT>
      v
[API Gateway REST API]
      |
      v
[Python Lambda Handlers]
      |
      |-- resolve Cognito sub
      |-- authorize against DynamoDB PROFILE + SUBJECT records
      |-- query DAILY_METRIC rows
      |-- query upload metadata through GSI1
      |-- mint presigned S3 URLs
      v
+------------------------------+
| DynamoDB: StrideAI          |
| - USER#sub / PROFILE        |
| - USER#sub / DAY#date       |
| - PROJECT#id / METADATA     |
| - PROJECT#id / SUBJECT#id   |
| - UPLOAD#id / USER#sub      |
| - GSI1 uploads by user/date |
+------------------------------+
               |
               v
         [S3 CSV Objects]
```

## DynamoDB Model
### Existing items
- `USER#<sub> / PROFILE`
- `USER#<sub> / DAY#<YYYY-MM-DD>`
- `PROJECT#<projectId> / METADATA`
- `UPLOAD#<uploadId> / USER#<sub>`

### New subject records
```json
{
  "pk": "PROJECT#proj001",
  "sk": "SUBJECT#SUB_001",
  "entityType": "SUBJECT",
  "subjectId": "SUB_001",
  "projectId": "proj001",
  "participantName": "jdoe",
  "status": "active",
  "groups": [
    {
      "groupId": "control",
      "groupName": "Control"
    }
  ],
  "groupIds": ["control"],
  "groupNames": ["Control"],
  "groupId": "control",
  "groupName": "Control",
  "lastUploadAt": "2026-05-14T05:08:30.959871+00:00",
  "userSub": "d1bbb550-7031-70e3-bcdb-ce2584fd08eb"
}
```

Subject group fields are optional and backward-compatible. `groups` is the canonical list; `groupIds`, `groupNames`, `groupId`, and `groupName` are convenience fields for roster display and simple filtering.

### Upload index GSI
Add `GSI1` to the `StrideAI` table:
- `GSI1PK = USER#<sub>`
- `GSI1SK = CREATED#<ISO8601 timestamp>#UPLOAD#<uploadId>`

Example upload item:
```json
{
  "pk": "UPLOAD#5ba9243d-e327-4d61-a5ac-9061cfd3a43d",
  "sk": "USER#d1bbb550-7031-70e3-bcdb-ce2584fd08eb",
  "GSI1PK": "USER#d1bbb550-7031-70e3-bcdb-ce2584fd08eb",
  "GSI1SK": "CREATED#2026-05-14T01:06:15.382197+00:00#UPLOAD#5ba9243d-e327-4a1e-a5ac-9061cfd3a43d",
  "projectId": "proj001",
  "projectName": "gaitStudy1",
  "fileName": "locations_2026-05-13.csv",
  "fileKey": "2026-05-14/jdoe/gaitStudy1/dr_smith/admin_rohan/locations_2026-05-13.csv",
  "contentType": "text/csv",
  "createdAt": "2026-05-14T01:06:15.382197+00:00"
}
```

## Lambda Set
- `create_project`
  - Admin-only study creation.
  - Writes `PROJECT#<projectId> / METADATA`.
- `request_upload_url_csv`
  - Validates CSV uploads.
  - Writes upload metadata with `GSI1PK`/`GSI1SK`.
  - Returns a presigned S3 PUT URL.
- `get_projects`
  - Returns accessible studies/projects. Admin users can see all project metadata.
- `get_project_subjects`
  - Returns subject roster under `PROJECT#<projectId>`, including group metadata when present.
- `update_subject_groups`
  - Adds, removes, replaces, or clears group assignments on one or more subjects.
- `get_participant_statistics`
  - Aggregates participant metrics across accessible studies/projects and optional group filters.
- `get_subject_miles`
  - Returns daily miles for a subject across a date range.
- `export_subject_csv`
  - Queries upload metadata by user/date via `GSI1`.
  - Returns presigned S3 GET URLs for matching CSV files.
- `link_patient_subject`
  - Links a Cognito patient user to a subject record.
- `create_pi_request`
  - Public PI access request intake for a name, email, target project, and optional note.
- `list_pi_requests`, `approve_pi_request`, `reject_pi_request`
  - Admin-only PI review flow. Approval creates or finds the Cognito user, adds the `pi` group, and writes the project-scoped profile.

## Frontend Flow
1. Sign in with Cognito.
2. Load `/projects`.
3. Load `/projects/{projectId}/subjects`.
4. Load `/subjects/{subjectId}/miles?start=...&end=...`.
5. Download CSV files from `/subjects/{subjectId}/export.csv?start=...&end=...`.
6. Load `/participants/statistics?start=...&end=...` for cross-study/group aggregate participant stats.

## Preview Later
CSV previews are intentionally deferred. When needed, add a parser Lambda that reads headers and stores parse metadata separately from upload metadata.
