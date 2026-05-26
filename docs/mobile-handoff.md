# StrideAI Mobile App Handoff

## Summary
This document describes the backend API available for the StrideAI iOS mobile app.
It covers authentication, endpoints, request/response contracts, and the data model
the mobile client should interact with.

## Authentication

### Cognito User Pools
Two pools exist:

| Pool | ID | Purpose |
|------|----|---------|
| App users (patients) | `us-east-2_xQiH4YW8S` | Patient accounts that upload data |
| Admin/PI | `us-east-2_1AOUqzUwA` | PI and coordinator accounts |

App client for the admin/PI pool: `5v5srf2ie60d8p0f6b165h9o83`

### Token usage
All API requests must include:
```
Authorization: Bearer <id_token>
```

Use the **id token** (not access token) from Cognito. The API Gateway Cognito authorizer validates id tokens by default.

### Cognito groups
The backend checks `cognito:groups` in the JWT to determine role:
- `admin` → admin role (full project access)
- `pi` or `coordinator` → project-scoped staff access
- `patient` → patient role (own subject only)
- No group → basic `user` role

## API Base URL
```
https://ny2twk3p4g.execute-api.us-east-2.amazonaws.com/prod
```

A `Test` stage also exists at the same API ID under `/Test`.

## Endpoints

### Daily Metrics Upload
```
POST /daily-metrics-upload/daily-metrics-upload
```
This is the existing endpoint the iOS app uses to upload daily metrics.
It uses the same Cognito authorizer as all other endpoints.

### Get Projects
```
GET /projects
```
Returns the projects visible to the authenticated user.

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

### Get Profile
```
GET /profile
```
Returns the authenticated patient's enrollment profile. Used by the iOS app
to determine enrollment status on launch.

Response:
```json
{
  "projectId": "proj001",
  "subjectId": "SUB_004",
  "participantName": "SUB_004",
  "username": "913b7510-4011-7053-1aab-ba3a00ff70a7"
}
```

`participantName` is guaranteed non-empty. Falls back to `subjectId` if no
display name was set during enrollment.

| Status | Error | Meaning |
|--------|-------|---------|
| 404 | `"No enrollment profile found"` | User has no PROFILE or no projectId |

### Get Project Subjects
```
GET /projects/{projectId}/subjects
```
Returns the subject roster for a project. Admin/PI/coordinator users also see `userSub`.

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
      "userSub": "d1bbb550-7031-70e3-bcdb-ce2584fd08eb"
    }
  ]
}
```

### Get Subject Miles
```
GET /subjects/{subjectId}/miles?start=YYYY-MM-DD&end=YYYY-MM-DD
```
Returns daily miles data for a subject in a date range.

Response:
```json
{
  "subjectId": "SUB_001",
  "projectId": "proj001",
  "range": { "start": "2026-05-01", "end": "2026-05-14" },
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

### Export Subject CSV
```
GET /subjects/{subjectId}/export.csv?start=YYYY-MM-DD&end=YYYY-MM-DD
```
Returns a manifest of downloadable CSV files with presigned S3 URLs.

Response:
```json
{
  "subjectId": "SUB_001",
  "projectId": "proj001",
  "range": { "start": "2026-05-01", "end": "2026-05-14" },
  "files": [
    {
      "uploadId": "5ba9243d-...",
      "fileName": "locations_2026-05-13.csv",
      "fileKey": "2026-05-14/jdoe/gaitStudy1/.../locations_2026-05-13.csv",
      "contentType": "text/csv",
      "createdAt": "2026-05-14T01:06:15.382197+00:00",
      "downloadUrl": "https://..."
    }
  ]
}
```

Presigned download URLs expire after 300 seconds by default.

### Upload CSV (Presign)
```
POST /uploads/presign
```
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
  "fileKey": "2026-05-14/jdoe/gaitStudy1/.../locations_2026-05-14.csv",
  "uploadId": "uuid",
  "expiresIn": 300
}
```

The client should then `PUT` the CSV file body to `uploadUrl` with `Content-Type: text/csv`.

### Link Patient to Subject (Admin only)
```
POST /admin/subject-links
```
Request:
```json
{
  "patientSub": "d1bbb550-7031-70e3-bcdb-ce2584fd08eb",
  "subjectId": "SUB_001",
  "projectId": "proj001"
}
```

### Delete User (Admin only)
```
DELETE /admin/users
```
Request:
```json
{
  "userSub": "d1bbb550-...",
  "username": "jdoe",
  "userPoolId": "us-east-2_xQiH4YW8S",
  "projectId": "proj001"
}
```

`username` and `userPoolId` are optional — only needed if you also want to delete the Cognito user (not just the DynamoDB records).

Response:
```json
{
  "userSub": "d1bbb550-...",
  "deleted": {
    "dynamoProfile": true,
    "cognitoUser": true,
    "subjectUnlinked": true
  }
}
```

## DynamoDB Data Model

Table: `StrideAI` (us-east-2)

| Record type | pk | sk | Key fields |
|-------------|----|----|------------|
| User profile | `USER#<sub>` | `PROFILE` | `projectId`, `subjectId`, `username` |
| Daily metric | `USER#<sub>` | `DAY#<YYYY-MM-DD>` | `miles`, `distanceMeters`, `sessionCount` |
| Project metadata | `PROJECT#<projectId>` | `METADATA` | `projectName`, `piName`, `adminName` |
| Subject | `PROJECT#<projectId>` | `SUBJECT#<subjectId>` | `participantName`, `status`, `userSub`, `groups`, `groupIds` |
| Upload metadata | `UPLOAD#<uploadId>` | `USER#<sub>` | `fileKey`, `fileName`, `contentType`, `createdAt` |

### GSI1 (uploads by user + date)
- `GSI1PK`: `USER#<sub>`
- `GSI1SK`: `CREATED#<ISO8601>#UPLOAD#<uploadId>`

## S3 Bucket
Bucket: `stride-ai-s3` (us-east-2)

File key pattern: `<date>/<username>/<projectName>/<piName>/<adminName>/<fileName>`

## Lambda Functions
All deployed with runtime Python 3.12, 256MB memory, 30s timeout.

| Function name | Route | Method |
|---------------|-------|--------|
| `StrideAI-get_profile` | `/profile` | GET |
| `StrideAI-get_projects` | `/projects` | GET |
| `StrideAI-get_project_subjects` | `/projects/{projectId}/subjects` | GET |
| `StrideAI-get_subject_miles` | `/subjects/{subjectId}/miles` | GET |
| `StrideAI-export_subject_csv` | `/subjects/{subjectId}/export.csv` | GET |
| `StrideAI-link_patient_subject` | `/admin/subject-links` | POST |
| `StrideAI-update_subject_groups` | `/admin/subject-groups` | POST |
| `StrideAI-get_participant_statistics` | `/participants/statistics` | GET |
| `StrideAI-request_upload_url_csv` | `/uploads/presign` | POST |
| `StrideAI-create_pi_request` | `/pi-requests` | POST |
| `StrideAI-list_pi_requests` | `/admin/pi-requests` | GET |
| `StrideAI-approve_pi_request` | `/admin/pi-requests/{requestId}/approve` | POST |
| `StrideAI-reject_pi_request` | `/admin/pi-requests/{requestId}/reject` | POST |
| `StrideAI-delete_user` | `/admin/users` | DELETE |
| `daily-metrics-upload` | `/daily-metrics-upload/daily-metrics-upload` | POST |

## Error Responses
All errors follow this format:
```json
{
  "error": "Human-readable message",
  "details": "Optional extra context"
}
```

Common status codes:
- `401` — Missing or invalid token / identity
- `403` — Authenticated but not authorized for this resource
- `404` — Subject or resource not found
- `500` — Internal server error

## Important Notes for Mobile

1. **Use id tokens**, not access tokens, in the Authorization header.
2. The daily metrics upload path is `/daily-metrics-upload/daily-metrics-upload` (doubled path segment — this is how it was originally configured).
3. Presigned upload URLs expire after 300 seconds. Upload promptly after requesting.
4. Presigned download URLs also expire after 300 seconds.
5. Patient users can only access their own subject's data once linked by an admin.
6. All CORS headers are configured — the API returns `Access-Control-Allow-Origin: *`.
