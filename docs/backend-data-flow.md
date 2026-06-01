# Backend Data Flow

This note describes how studies, staff users, participants, subjects, and uploads are connected in the current StrideAI backend. It also records the target direction for multi-project staff access.

## Identity And Scope

StrideAI uses two Cognito user pools:

- Staff pool: admins, PIs, and coordinators.
- Participant pool: mobile app users.

Staff roles come from Cognito groups:

- `admin` has global access.
- `pi` and `coordinator` are project-scoped staff roles.

Participant users do not need Cognito groups. Their app access comes from DynamoDB.

Most Lambda handlers resolve access in this order:

1. Extract the Cognito `sub` from the JWT.
2. Resolve role from `cognito:groups`.
3. Read `USER#<sub> / PROFILE` from DynamoDB.
4. Use the profile to determine project and subject scope.

The current live shared API model uses separate staff and participant scope fields:

- Staff `pi`/`coordinator` profiles use `PROFILE.projectIds`.
- Participant profiles use `PROFILE.projectId` and `PROFILE.subjectId`.
- Admins bypass project checks through the Cognito `admin` group.

## Projects, Admins, And PIs

A project/study is a DynamoDB metadata item:

```text
pk = PROJECT#<projectId>
sk = METADATA
projectId
projectName
piName
adminName
```

Projects are created by admins with `POST /admin/projects`, which writes `PROJECT#<projectId> / METADATA`.

Admins are not connected to projects through a membership table. Admins are global because the staff-pool Cognito user is in the `admin` group.

PI/coordinator access is represented by a staff profile with one or more project IDs:

```json
{
  "pk": "USER#<piSub>",
  "sk": "PROFILE",
  "role": "pi",
  "projectIds": ["proj001", "proj002"],
  "email": "pi@example.edu",
  "username": "pi@example.edu"
}
```

The intended PI request flow is implemented in source but may need live deployment:

1. PI submits `POST /pi-requests` with name, email, requested project ID, and optional note.
2. Backend verifies the project exists.
3. Request is stored under `PI_REQUESTS / REQUEST#<requestId>`.
4. Admin lists pending requests with `GET /admin/pi-requests`.
5. Admin approves with `POST /admin/pi-requests/{requestId}/approve`.
6. Approval finds or creates a staff-pool Cognito user, adds the `pi` group, and writes the PI profile.

Admins can either ignore `projectIds` or use a special global convention, because the `admin` group remains the source of global access.

## Subjects And Enrollment

Subjects belong to projects. A subject is stored in the project partition:

```text
pk = PROJECT#<projectId>
sk = SUBJECT#<subjectId>
```

Example:

```json
{
  "pk": "PROJECT#proj001",
  "sk": "SUBJECT#EKH_TEST",
  "entityType": "SUBJECT",
  "projectId": "proj001",
  "subjectId": "EKH_TEST",
  "participantName": "Erik Henricson",
  "status": "active",
  "userSub": "91eb3540-f0d1-7058-5784-34ebbfd0591b",
  "lastUploadAt": "2026-05-27T23:32:51.316813+00:00"
}
```

Staff create subjects with `POST /admin/subjects`. Despite the route prefix, the Lambda accepts staff roles and relies on project authorization to decide whether a PI can create a subject in the selected project.

Enrollment connects a participant account to a subject:

1. Staff creates a subject under `PROJECT#<projectId>`.
2. Staff creates an enrollment code with `POST /admin/enrollment-codes`.
3. The code item stores `projectId`, `subjectId`, participant name, and `status = active`.
4. Participant enters the code in the mobile app with `POST /enroll`.
5. Backend writes `USER#<participantSub> / PROFILE`.
6. Backend stamps `userSub` onto the subject.
7. Backend marks the enrollment code used.

Participant profile shape:

```text
pk = USER#<participantSub>
sk = PROFILE
projectId = <projectId>
subjectId = <subjectId>
participantName
username
enrollmentCode
enrolledAt
updatedAt
```

After enrollment, the link is two-way:

```text
Participant profile -> projectId + subjectId
Subject record -> userSub
```

## Participant Uploads

Participant uploads are scoped through `USER#<participantSub> / PROFILE`, not through a caller-supplied project ID.

For uploads, the backend:

1. Extracts the participant Cognito `sub`.
2. Loads `USER#<participantSub> / PROFILE`.
3. Reads `projectId` and sometimes `subjectId`.
4. Loads `PROJECT#<projectId> / METADATA`.
5. Writes metric or upload metadata using that project context.

Daily metrics are stored under the participant partition:

```text
pk = USER#<participantSub>
sk = DAY#<YYYY-MM-DD>
entityType = DAILY_METRIC
miles
distanceMeters
sessionCount
projectName
piName
adminName
updatedAt
```

File upload metadata is stored separately:

```text
pk = UPLOAD#<uploadId>
sk = USER#<participantSub>
GSI1PK = USER#<participantSub>
GSI1SK = CREATED#<timestamp>#UPLOAD#<uploadId>
projectId
projectName
fileName
fileKey
contentType
status
createdAt
updatedAt
```

The S3 object key is built from project metadata:

```text
<date>/<username>/<projectName>/<piName>/<adminName>/<fileName>
```

Known issue: upload paths do not consistently stamp `PROJECT#<projectId> / SUBJECT#<subjectId>.lastUploadAt`.

### `lastUploadAt` audit

Audit date: 2026-05-28.

There are three live upload-style paths:

- `POST /daily-metrics-upload/daily-metrics-upload` -> `daily-metrics-upload`
- `POST /` -> `Stride-AI-Upload`
- `POST /uploads/presign` -> `StrideAI-request_upload_url_csv`

Findings:

- `Stride-AI-Upload` already attempts to update the subject record, but its IAM role only allows `dynamodb:GetItem` and `dynamodb:PutItem` on `StrideAI`. CloudWatch shows repeated `AccessDeniedException` failures for `dynamodb:UpdateItem` while trying to update `proj001/EKH_TEST`.
- `daily-metrics-upload` has `dynamodb:UpdateItem` permission, but the handler only upserts `USER#<sub> / DAY#<date>` rows. It does not read `subjectId` from the participant profile and does not update the linked subject.
- `StrideAI-request_upload_url_csv` writes upload metadata at presign time. It does not update `lastUploadAt`; stamping here is convenient but can mark activity even if the client never completes the S3 `PUT`.
- Root `POST /` is integrated with `Stride-AI-Upload` and currently has API Gateway authorization set to `NONE`. The Lambda tries to recover identity by decoding the bearer JWT payload itself. It should be protected by the Cognito authorizer if the route remains active.

Recommended fix order:

1. Add `dynamodb:UpdateItem` to `Stride-AI-Upload-role-yry790ej` for the `StrideAI` table.
2. Patch `daily_metrics_upload.py` to return `projectId` and `subjectId` from the profile lookup, then update the linked subject's `lastUploadAt` after successful metric upsert.
3. Add a condition to subject timestamp updates so stale profiles cannot create partial subject rows.
4. For `/uploads/presign`, stamp `lastUploadAt` when upload metadata is created; if exact completion semantics become important, add an upload-complete callback or S3 event path later.
5. Put the Cognito authorizer on root `POST /` or retire that route in favor of `/uploads/presign`.
6. Backfill existing subjects from the latest upload metadata and daily metric timestamps.

## Dashboard Read Paths

Project list:

```text
GET /projects
```

- Admins receive all `PROJECT#... / METADATA` items.
- PIs/coordinators receive every project listed in `PROFILE.projectIds`.

Roster:

```text
GET /projects/{projectId}/subjects
```

This reads `PROJECT#<projectId> / SUBJECT#...` and authorizes the requested project.

Subject miles:

```text
GET /subjects/{subjectId}/miles?start=YYYY-MM-DD&end=YYYY-MM-DD
```

This resolves subject access, finds the subject's `userSub`, and reads:

```text
USER#<subjectUserSub> / DAY#...
```

CSV export:

```text
GET /subjects/{subjectId}/export.csv?start=YYYY-MM-DD&end=YYYY-MM-DD
```

This resolves subject access, finds the subject's `userSub`, queries upload metadata through `GSI1`, filters to CSV uploads for the project, and returns presigned S3 download URLs.

For multi-project staff users, subject detail calls pass `projectId` explicitly instead of relying on a default profile project.

## Current Weak Points

- Upload paths do not consistently update subject `lastUploadAt`.
- Root `POST /` upload route needs Cognito authorization or deprecation.

## Target Direction

Keep participant profiles single-project:

```json
{
  "projectId": "proj001",
  "subjectId": "SUB_001"
}
```

Move staff profiles to multi-project access:

```json
{
  "role": "pi",
  "projectIds": ["proj001", "proj002"],
  "username": "pi@example.edu",
  "email": "pi@example.edu"
}
```

Admins remain global through Cognito `admin`; project assignment is not required for admin access.
