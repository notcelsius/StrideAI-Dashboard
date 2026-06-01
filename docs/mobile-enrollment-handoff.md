# StrideAI Mobile Enrollment — Handoff for iOS Team

## Overview
Patient access to the StrideAI system is gated by enrollment codes. A PI or admin
generates a one-time code in the dashboard, gives it to the patient, and the patient
enters it in the iOS app to activate their account. This creates the patient's backend
profile and links them to their study subject.

Until a patient enrolls with a valid code, they have no profile, no project access,
and any data they upload will be tagged as `unknown_user` / `unassigned`.

## End-to-End Flow

```
PI/Admin (Dashboard)                    Patient (iOS App)
─────────────────────                   ─────────────────
1. Creates subject in project
2. Generates enrollment code
   (e.g. "A3F7B1C9")
3. Gives code to patient
   (verbally, printed, etc.)
                                        4. Signs up in Cognito
                                           (gets account + sub)
                                        5. Enters enrollment code
                                           in the app
                                        6. App calls POST /enroll
                                           with JWT + code
                                        7. Backend validates code,
                                           creates PROFILE,
                                           links to subject
                                        8. App proceeds — uploads
                                           now tagged correctly
```

## What the iOS App Needs to Implement

### 1. Enrollment Screen
After Cognito sign-up/sign-in, check if the user has a profile by calling:
```
GET /projects
```
If the response returns `{"projects": []}`, the user is not enrolled yet.
Show an enrollment screen with a single text field for the code.

### 2. Redeem the Code
```
POST /enroll
Authorization: Bearer <id_token>
Content-Type: application/json

{
  "code": "A3F7B1C9"
}
```

The code is case-insensitive (the backend uppercases it).

### Success Response (200)
```json
{
  "enrolled": true,
  "projectId": "proj001",
  "subjectId": "SUB_001",
  "participantName": "jdoe"
}
```

**Note:** `participantName` is guaranteed to be non-empty. If no name was
set during enrollment code creation, it falls back to `subjectId`.

After this, navigate to the main app screen. All subsequent API calls
(daily metrics upload, etc.) will work correctly.

### Error Responses

| Status | Error | Meaning |
|--------|-------|---------|
| 400 | `"code is required"` | Empty code submitted |
| 404 | `"Invalid enrollment code"` | Code doesn't exist |
| 410 | `"Enrollment code has already been used"` | Code was already redeemed |
| 409 | `"This account is already enrolled in a project"` | User already has a PROFILE with a projectId |
| 409 | `"Subject is already linked to another patient"` | Another patient already claimed this subject |
| 401 | `"Unauthorized..."` | Missing or invalid JWT |

### 3. Recommended App Flow

```
App Launch
    │
    ├── Not signed in → Cognito sign-in/sign-up
    │
    └── Signed in
         │
         ├── GET /projects
         │    │
         │    ├── Has projects → Main app (upload, view data)
         │    │
         │    └── Empty projects → Enrollment screen
         │         │
         │         ├── Enter code → POST /enroll
         │         │    │
         │         │    ├── 200 → Main app
         │         │    └── Error → Show message, let retry
         │         │
         │         └── Skip? (optional — up to you whether
         │              unenrolled users can see anything)
```

## API Base URL
```
https://ny2twk3p4g.execute-api.us-east-2.amazonaws.com/prod
```

## Authentication Details

### Cognito User Pool for Patients
- Pool ID: `us-east-2_xQiH4YW8S`
- The iOS app should authenticate against this pool

### Token Usage
All API requests require:
```
Authorization: Bearer <id_token>
```

Use the **id token**, not the access token. The API Gateway Cognito
authorizer validates id tokens by default.

## Enrollment Code Properties
- Format: 8-character uppercase hex string (e.g. `A3F7B1C9`)
- One-time use — once redeemed, the code is marked `used`
- Each code is tied to exactly one project + subject
- A subject can only have one linked patient

## What Happens on the Backend When a Code is Redeemed

1. **PROFILE record created**: `USER#<sub> / PROFILE` with `projectId`, `username`, `enrollmentCode`
2. **Subject linked**: `PROJECT#<projectId> / SUBJECT#<subjectId>` gets `userSub` set to the patient's sub
3. **Code marked used**: `ENROLLMENT#<code> / META` status changes from `active` to `used`

After this, the `daily-metrics-upload` Lambda will correctly resolve the patient's
username and project from their PROFILE, and all data lands in the right place.

## Daily Metrics Upload (Existing Endpoint)
The existing upload endpoint continues to work the same way:
```
POST /daily-metrics-upload/daily-metrics-upload
Authorization: Bearer <id_token>
Content-Type: application/json

{
  "days": [
    {
      "date": "2026-05-19",
      "miles": 3.45,
      "distanceMeters": 5552.24,
      "sessionCount": 2
    }
  ]
}
```

The only difference is that enrolled users will have their data correctly
associated with their project and username instead of `unknown_user`.

## Testing Checklist for iOS Team

- [ ] Sign up a new Cognito user in the patient pool
- [ ] Verify `GET /projects` returns empty before enrollment
- [ ] Generate an enrollment code from the admin dashboard
- [ ] Redeem the code via `POST /enroll`
- [ ] Verify `GET /projects` now returns the project
- [ ] Upload daily metrics and verify they appear on the dashboard
- [ ] Try redeeming the same code again — should get 410
- [ ] Try enrolling an already-enrolled user — should get 409
- [ ] Try an invalid code — should get 404

## DynamoDB Record Created by Enrollment

```json
{
  "pk": "USER#<cognito_sub>",
  "sk": "PROFILE",
  "projectId": "proj001",
  "username": "jdoe",
  "enrolledAt": "2026-05-19T...",
  "enrollmentCode": "A3F7B1C9",
  "updatedAt": "2026-05-19T..."
}
```

## Questions for iOS Team
1. Which Cognito pool is the iOS app currently authenticating against?
   (Should be `us-east-2_xQiH4YW8S` for patients)
2. Is the app currently calling `daily-metrics-upload` successfully with
   a JWT, or using AWS_IAM signing? (We switched the authorizer to
   Cognito — if the app was using SigV4/IAM, it needs to switch to
   sending `Bearer <id_token>` instead)
