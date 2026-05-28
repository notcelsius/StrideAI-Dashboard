# StrideAI AWS Handoff

## Summary
This document is the handoff for the current StrideAI dashboard/backend work. It captures:

- the backend/data model information provided during planning
- the implementation decisions made from that information
- what has already been added to this repo
- what still needs to be executed in AWS
- the exact DynamoDB, S3, API, and Lambda assumptions the next agent should use

This handoff is intended for another agent or engineer to finish the AWS-side setup and connect the deployed backend to the frontend.

For the current end-to-end identity, project, PI/admin, participant enrollment, and upload flow, see [Backend Data Flow](./backend-data-flow.md).

## Current Product Goal
The app uses Cognito and AWS. The dashboard needs to support:

- project-scoped access control
- subject roster display
- adjustable date-range miles dashboard
- CSV download/export

The current direction is:

- daily miles are already precomputed and stored in DynamoDB
- uploaded files will be CSV-only going forward
- CSV files are treated as opaque downloadable files in v1
- dashboard analytics come from DynamoDB daily metric records, not from parsing CSV rows
- CSV preview/parsing is deferred to a later phase

## User-Provided Backend Facts

### Storage model
- Raw trackpoint/GPX data was historically stored in S3, keyed by Dynamo metadata.
- Miles already live as separate DynamoDB records.
- Uploads are currently written by Python Lambdas exposed through API Gateway.
- The backend will change to upload CSV going forward.
- Reads of blobs from S3 are acceptable.

### Auth/access requirements
- Cognito is the identity system.
- Backend authorization should ensure a user can only access data for the right project.
- Cognito group roles are `admin` for global access and `pi`/`coordinator` for project-scoped staff access. `pi_admin` is not used.
- Admin seed emails are `ehenricson@health.ucdavis.edu` and `ehenricson@ucdavis.edu`; `rsheth@ucdavis.edu` is a temporary development admin.
- The desired domain model is:
  - `Project` owns many `Subjects`
  - `Subject` belongs to one `Project`
  - PI/coordinator users access project-scoped data
  - patient users access only their own subject

### Current API/runtime choices
- Lambdas are Python.
- API Gateway uses REST API with proxy integration.
- Cognito `sub` can be used as the stable identity key.

## Current DynamoDB Model From User Examples
The existing table is `StrideAI`.

Observed item families:

### User daily metrics
- `pk = USER#<cognito_sub>`
- `sk = DAY#<YYYY-MM-DD>`
- `entityType = DAILY_METRIC`

Example:

```text
pk: USER#d1bbb550-7031-70e3-bcdb-ce2584fd08eb
sk: DAY#2026-05-13
entityType: DAILY_METRIC
date: 2026-05-13
distanceMeters: 145105.10241786500
miles: 90.16413048910930
projectName: gaitStudy1
piName: dr_smith
sessionCount: 26
updatedAt: 2026-05-14T05:08:32.072925+00:00
userId: d1bbb550-7031-70e3-bcdb-ce2584fd08eb
username: jdoe
```

### User profile
- `pk = USER#<cognito_sub>`
- `sk = PROFILE`

Example:

```text
pk: USER#d1bbb550-7031-70e3-bcdb-ce2584fd08eb
sk: PROFILE
projectId: proj001
username: jdoe
```

Important note:
- Current live access model is effectively single-project-per-user because `PROFILE.projectId` stores one project id.
- The implementation in this repo keeps that as the v1 source of truth, but wraps it behind a helper so a future multi-project access model can replace it cleanly.

### Project metadata
- `pk = PROJECT#<projectId>`
- `sk = METADATA`

Example:

```text
pk: PROJECT#proj001
sk: METADATA
adminName: admin_rohan
piName: dr_smith
projectName: gaitStudy1
```

### Upload metadata
- `pk = UPLOAD#<uploadId>`
- `sk = USER#<cognito_sub>`

Examples include historical GPX and JSON uploads such as:

```text
pk: UPLOAD#5ba9243d-e327-4d61-a5ac-9061cfd3a43d
sk: USER#d1bbb550-7031-70e3-bcdb-ce2584fd08eb
adminName: admin_rohan
contentType: application/gpx+xml
createdAt: 2026-05-14T01:06:15.382197+00:00
fileKey: 2026-05-14/jdoe/gaitStudy1/dr_smith/admin_rohan/track_2026-05-13_18-06-13.gpx
fileName: track_2026-05-13_18-06-13.gpx
piName: dr_smith
projectName: gaitStudy1
status: pending
username: jdoe
```

There are also JSON upload items with the same key structure.

### Historical file example
The user provided a GPX example showing historical uploads were full blob objects in S3 and should not be treated as row-level Dynamo data.

## Final Design Decisions Reached

### v1 access model
- Use Cognito `sub` as the backend identity key.
- Use `USER#<sub> / PROFILE.projectId` as the current access source.
- Keep access resolution isolated in code so multi-project support can be added later.
- Do not encode per-project access in Cognito groups for v1.

### v1 file model
- New uploads are CSV-only going forward.
- V1 CSV handling is schema-agnostic.
- CSVs are treated as opaque files.
- The dashboard does not parse CSV data in v1.
- Export returns downloadable CSV files, not merged or parsed CSV content.

### v1 analytics model
- Daily metric rows in DynamoDB remain the source of truth for charts/KPIs.
- Subject detail screens query miles by date range from DynamoDB.

### v1 patient linkage
- Staff/admin users link a patient Cognito user to a subject record.
- Patient users can only see their own subject.

### Export behavior
- Export should not proxy file bytes through Lambda.
- Lambda should authorize the request, query the matching upload metadata, and return presigned S3 download URLs.

## Additional DynamoDB Structures Required

### Subject roster records
These do not appear to exist yet in the examples and should be created.

Recommended shape:

```json
{
  "pk": "PROJECT#proj001",
  "sk": "SUBJECT#SUB_001",
  "entityType": "SUBJECT",
  "subjectId": "SUB_001",
  "projectId": "proj001",
  "participantName": "jdoe",
  "status": "active",
  "lastUploadAt": "2026-05-14T05:08:30.959871+00:00",
  "userSub": "d1bbb550-7031-70e3-bcdb-ce2584fd08eb"
}
```

Important fields:
- `subjectId`
- `projectId`
- `participantName`
- `status`
- `lastUploadAt`
- `userSub` for the linked patient

## Required New GSI On Upload Metadata
This is required for efficient export/download by user and date range.

### GSI definition
- Index name: `GSI1`
- Partition key: `GSI1PK` as `String`
- Sort key: `GSI1SK` as `String`

### Intended values on each upload item
- `GSI1PK = USER#<cognito_sub>`
- `GSI1SK = CREATED#<ISO8601 timestamp>#UPLOAD#<uploadId>`

Example:

```json
{
  "pk": "UPLOAD#5ba9243d-e327-4d61-a5ac-9061cfd3a43d",
  "sk": "USER#d1bbb550-7031-70e3-bcdb-ce2584fd08eb",
  "GSI1PK": "USER#d1bbb550-7031-70e3-bcdb-ce2584fd08eb",
  "GSI1SK": "CREATED#2026-05-14T01:06:15.382197+00:00#UPLOAD#5ba9243d-e327-4d61-a5ac-9061cfd3a43d"
}
```

### Why this index exists
Without it, `UPLOAD#... / USER#...` items are not efficiently queryable by date range for a given subject/user. Export-by-range would otherwise require scans.

## What Was Implemented In This Repo

### Backend Lambda scaffold
Added under [backend/lambdas](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/backend/lambdas):

- `common.py`
- `get_projects.py`
- `get_project_subjects.py`
- `get_subject_miles.py`
- `export_subject_csv.py`
- `link_patient_subject.py`
- `request_upload_url_csv.py`
- `requirements.txt`

### Backend behavior in the scaffold

#### `common.py`
Shared helpers for:
- extracting Cognito claims/sub
- resolving access context from `PROFILE.projectId`
- resolving roles from Cognito groups
- enforcing global admin, project-scoped staff, and admin email allowlist helpers
- requiring project or subject access
- querying project subjects
- querying daily metrics
- querying uploads through `GSI1`
- generating presigned S3 download URLs

#### `get_projects.py`
- Returns the user’s visible project list.
- In v1 this is effectively `0..1` projects because access comes from `PROFILE.projectId`.

#### `get_project_subjects.py`
- Returns the subject roster under `PROJECT#<projectId>`.
- Enforces project access.

#### `get_subject_miles.py`
- Inputs: `subjectId`, `start`, `end`
- Resolves subject ownership and project authorization.
- Reads `USER#<subjectSub> / DAY#<date>` records in the range.
- Returns:
  - `subjectId`
  - `projectId`
  - `range`
  - `dailyMiles`
  - `totalMiles`
  - `averageMiles`

#### `export_subject_csv.py`
- Inputs: `subjectId`, `start`, `end`
- Authorizes subject access.
- Queries upload metadata using `GSI1`.
- Filters to CSV uploads.
- Returns a JSON manifest of downloadable files with presigned S3 GET URLs.

#### `link_patient_subject.py`
- Protected staff/admin endpoint.
- Links an existing Cognito patient `sub` to a subject record.
- Updates:
  - the subject record’s `userSub`
  - the patient profile’s `projectId`

#### `create_pi_request.py`
- Public endpoint for PI access requests.
- Stores `PI_REQUEST` records under `PI_REQUESTS / REQUEST#<requestId>`.

#### `list_pi_requests.py`, `approve_pi_request.py`, `reject_pi_request.py`
- Admin-only PI review endpoints.
- Approval creates or finds the Cognito user in the admin/PI pool, adds group `pi`, and writes `USER#<sub> / PROFILE` with project-scoped PI access.

#### `request_upload_url_csv.py`
- CSV-only presign Lambda.
- Validates CSV content types and `.csv` file extension.
- Writes upload metadata with `GSI1PK` and `GSI1SK`.
- Returns a presigned S3 PUT URL.

### Frontend integration
Added [lib/dashboardApi.js](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/lib/dashboardApi.js) and updated pages to use it:

- [app/dashboard/page.js](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/app/dashboard/page.js)
- [app/dashboard/subject/[subjectId]/page.js](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/app/dashboard/subject/%5BsubjectId%5D/page.js)

Behavior:
- If `NEXT_PUBLIC_API_BASE_URL` is configured, the UI uses the API.
- If not configured, the UI falls back to local demo data so it still runs.
- Subject detail now supports:
  - adjustable date range
  - miles retrieval for that range
  - loading matching CSV exports for that range

### Docs and scripts
- [docs/backend-architecture.md](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/docs/backend-architecture.md)
- [backend/scripts/backfill_upload_gsi.py](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/backend/scripts/backfill_upload_gsi.py)

### Environment changes
Added `NEXT_PUBLIC_API_BASE_URL` to [.env.example](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/.env.example).

## Verification Already Performed
- `python3 -m py_compile backend/lambdas/*.py`
- `python3 -m py_compile backend/scripts/backfill_upload_gsi.py`
- `npm run build`

These completed successfully in the repo after implementation.

## AWS Work Still Required

### 1. Create the DynamoDB upload GSI
In AWS DynamoDB for table `StrideAI`:

- Add `GSI1`
- Partition key: `GSI1PK` (`String`)
- Sort key: `GSI1SK` (`String`)

Wait until the index is `ACTIVE`.

### 2. Backfill old upload metadata rows
Use the provided script:

[backend/scripts/backfill_upload_gsi.py](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/backend/scripts/backfill_upload_gsi.py)

Run dry-run first:

```bash
python3 backend/scripts/backfill_upload_gsi.py --dry-run
```

If using a named AWS profile:

```bash
python3 backend/scripts/backfill_upload_gsi.py --dry-run --profile your-profile
```

Then real write:

```bash
python3 backend/scripts/backfill_upload_gsi.py
```

or:

```bash
python3 backend/scripts/backfill_upload_gsi.py --profile your-profile
```

What it does:
- scans `UPLOAD#` items
- derives:
  - `GSI1PK = sk`
  - `GSI1SK = "CREATED#" + createdAt + "#" + pk`
- updates only items that need it
- supports `--limit` and `--dry-run`

### 3. Create subject roster items
If subject records do not already exist, insert records shaped like:

```json
{
  "pk": "PROJECT#proj001",
  "sk": "SUBJECT#SUB_001",
  "entityType": "SUBJECT",
  "subjectId": "SUB_001",
  "projectId": "proj001",
  "participantName": "jdoe",
  "status": "active",
  "lastUploadAt": "2026-05-14T05:08:30.959871+00:00",
  "userSub": "d1bbb550-7031-70e3-bcdb-ce2584fd08eb"
}
```

This is required for:
- `/projects/{projectId}/subjects`
- subject lookup/authorization
- patient linkage

### 4. Deploy the Python Lambdas
The Lambdas in `backend/lambdas` need to be packaged and deployed in AWS.

Expected runtime assumptions:
- Python
- region `us-east-2`
- table `StrideAI`
- bucket `stride-ai-s3`

Important environment variables used in code:
- `TABLE_NAME` default `StrideAI`
- `BUCKET_NAME` default `stride-ai-s3`
- `AWS_REGION` default `us-east-2`
- `UPLOAD_INDEX_NAME` default `GSI1`
- `UPLOAD_URL_TTL_SECONDS` default `300`

### 5. Wire API Gateway routes
Expected REST proxy routes:

- `GET /projects`
- `GET /projects/{projectId}/subjects`
- `GET /subjects/{subjectId}/miles?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /subjects/{subjectId}/export.csv?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /participants/statistics?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `POST /admin/projects`
- `POST /admin/subject-links`
- `POST /admin/subject-groups`
- `POST /uploads/presign`
- `POST /pi-requests`
- `GET /admin/pi-requests`
- `POST /admin/pi-requests/{requestId}/approve`
- `POST /admin/pi-requests/{requestId}/reject`

### 6. Ensure auth context reaches Lambda
The code expects Cognito claims in API Gateway authorizer context, primarily:
- `sub`
- optionally `email`, `preferred_username`, `cognito:groups`

The helpers can also decode a bearer token payload as fallback, but the intended path is authorizer claims.

### 7. Update frontend config
Set:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-api-id.execute-api.us-east-2.amazonaws.com/prod
```

When this is not set, the frontend uses demo fallback data.

## API Contract Implemented In Code

### `POST /admin/projects`
Admin-only study creation.

Request:

```json
{
  "projectId": "proj002",
  "projectName": "Balance Study",
  "piName": "Dr. Smith",
  "adminName": "Study Admin"
}
```

Response:

```json
{
  "projectId": "proj002",
  "projectName": "Balance Study",
  "piName": "Dr. Smith",
  "adminName": "Study Admin"
}
```

### `GET /projects`
Response:

```json
{
  "projects": [
    {
      "projectId": "proj001",
      "projectName": "gaitStudy1",
      "piName": "dr_smith",
      "adminName": "admin_rohan"
    }
  ]
}
```

### `GET /projects/{projectId}/subjects`
Response:

```json
{
  "projectId": "proj001",
  "subjects": [
    {
      "subjectId": "SUB_001",
      "participantName": "jdoe",
      "status": "active",
      "lastUploadAt": "2026-05-14T05:08:30.959871+00:00",
      "groups": [
        {
          "groupId": "control",
          "groupName": "Control"
        }
      ],
      "groupIds": ["control"],
      "groupId": "control",
      "groupName": "Control"
    }
  ]
}
```

### `GET /subjects/{subjectId}/miles?start=YYYY-MM-DD&end=YYYY-MM-DD`
Response:

```json
{
  "subjectId": "SUB_001",
  "projectId": "proj001",
  "range": {
    "start": "2026-05-01",
    "end": "2026-05-14"
  },
  "dailyMiles": [
    {
      "date": "2026-05-13",
      "miles": 90.1641304891093,
      "distanceMeters": 145105.102417865,
      "sessionCount": 26
    }
  ],
  "totalMiles": 90.16,
  "averageMiles": 90.16
}
```

### `GET /subjects/{subjectId}/export.csv?start=YYYY-MM-DD&end=YYYY-MM-DD`
Response:

```json
{
  "subjectId": "SUB_001",
  "projectId": "proj001",
  "range": {
    "start": "2026-05-01",
    "end": "2026-05-14"
  },
  "files": [
    {
      "uploadId": "5ba9243d-e327-4d61-a5ac-9061cfd3a43d",
      "fileName": "locations_2026-05-13.csv",
      "fileKey": "2026-05-14/jdoe/gaitStudy1/dr_smith/admin_rohan/locations_2026-05-13.csv",
      "contentType": "text/csv",
      "createdAt": "2026-05-14T01:06:15.382197+00:00",
      "downloadUrl": "https://..."
    }
  ]
}
```

### `POST /admin/subject-links`
Request:

```json
{
  "patientSub": "d1bbb550-7031-70e3-bcdb-ce2584fd08eb",
  "subjectId": "SUB_001",
  "projectId": "proj001"
}
```

Response:

```json
{
  "patientSub": "d1bbb550-7031-70e3-bcdb-ce2584fd08eb",
  "subjectId": "SUB_001",
  "projectId": "proj001"
}
```

### `POST /admin/subject-groups`
Request:

```json
{
  "projectId": "proj001",
  "subjectIds": ["SUB_001", "SUB_002"],
  "mode": "add",
  "groups": [
    {
      "groupId": "control",
      "groupName": "Control"
    }
  ]
}
```

`mode` can be `replace`, `add`, `remove`, or `clear`.

Response:

```json
{
  "projectId": "proj001",
  "mode": "add",
  "updatedCount": 2,
  "subjects": [
    {
      "subjectId": "SUB_001",
      "participantName": "jdoe",
      "status": "active",
      "groups": [
        {
          "groupId": "control",
          "groupName": "Control"
        }
      ],
      "groupIds": ["control"],
      "userSub": "d1bbb550-7031-70e3-bcdb-ce2584fd08eb"
    }
  ]
}
```

### `GET /participants/statistics?start=YYYY-MM-DD&end=YYYY-MM-DD`
Optional filters:
- `projectId` / `projectIds`
- `studyId` / `studyIds` as aliases for project IDs
- `groupId` / `groupIds`
- `subjectId` / `subjectIds`
- `includeDaily=true` to include each participant's daily metric rows

Response:

```json
{
  "range": {
    "start": "2026-05-01",
    "end": "2026-05-14"
  },
  "aggregate": {
    "participantCount": 3,
    "linkedParticipantCount": 2,
    "unlinkedParticipantCount": 1,
    "participantsWithMetrics": 1,
    "totalMiles": 90.16,
    "totalDistanceMeters": 145105.1,
    "totalSessionCount": 26,
    "activeDays": 1,
    "averageMilesPerParticipant": 30.05
  },
  "dailyTotals": [
    {
      "date": "2026-05-13",
      "miles": 90.16,
      "distanceMeters": 145105.1,
      "sessionCount": 26,
      "participantCount": 1
    }
  ],
  "byStudy": [],
  "byGroup": [],
  "participants": []
}
```

### `POST /uploads/presign`
Request:

```json
{
  "fileName": "locations_2026-05-14.csv",
  "contentType": "text/csv"
}
```

Response:

```json
{
  "uploadUrl": "https://...",
  "fileKey": "2026-05-14/jdoe/gaitStudy1/dr_smith/admin_rohan/locations_2026-05-14.csv",
  "uploadId": "uuid",
  "expiresIn": 300
}
```

## Architecture Diagram

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
      |-- authorize against PROFILE + SUBJECT
      |-- query DAILY_METRIC rows
      |-- query uploads through GSI1
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

## Deferred Work

### CSV preview/parsing
This was intentionally deferred.

Final decision:
- make v1 CSV handling schema-agnostic
- do not lock a row schema in the current backend
- add preview/parsing later once the CSV format stabilizes

Potential later design:
- parser Lambda reads CSV headers/metadata
- store parse metadata separately
- allow extra columns
- add preview endpoint after schema stabilizes

## Important Repo Notes
At implementation time, the repo already had unrelated modified/untracked files from prior work. Those were not reverted.

Previously existing changed/untracked areas included:
- `.gitignore`
- `app/layout.js`
- `app/login/page.js`
- `lib/demoData.js`
- `lib/cognitoAuth.js`
- `lib/dashboardData.js`

The next agent should be careful not to overwrite user work while packaging/deploying.

## Recommended Immediate Next Steps For The Next Agent
1. Create `GSI1` on `StrideAI`.
2. Run the backfill script in dry-run mode.
3. Run the real backfill.
4. Insert or migrate subject roster items.
5. Deploy the Lambda functions.
6. Configure API Gateway routes and Cognito authorizer.
7. Set `NEXT_PUBLIC_API_BASE_URL` in the frontend environment.
8. Test:
   - project list
   - subject roster
   - miles by date range
   - CSV export manifest
   - patient linkage
