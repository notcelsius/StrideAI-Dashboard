# StrideAI Dashboard

Next.js dashboard for Cognito-authenticated study users, with a Python Lambda backend plan and implementation scaffold for:

- project-scoped subject roster reads
- daily miles retrieval by date range
- CSV upload/download through S3
- Cognito-authenticated access control backed by DynamoDB

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` into `.env.local` and fill in:

- `NEXT_PUBLIC_COGNITO_*` for browser auth
- `NEXT_PUBLIC_API_BASE_URL` for the API Gateway base URL

## Backend

Backend Lambda scaffolding lives in [backend/lambdas](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/backend/lambdas) and the architecture/spec is in [docs/backend-architecture.md](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/docs/backend-architecture.md).

One-off DynamoDB migration scripts live in [backend/scripts](/Users/rohansheth/Documents/ECS193A/StrideAI-Dashboard/backend/scripts). The current backfill script populates `GSI1PK` and `GSI1SK` on existing upload metadata rows after the `GSI1` index is created.

The backend assumes:

- DynamoDB table `StrideAI`
- S3 bucket `stride-ai-s3`
- API Gateway REST proxy integration
- upload metadata GSI `GSI1` with:
  - `GSI1PK = USER#<sub>`
  - `GSI1SK = CREATED#<timestamp>#UPLOAD#<id>`

## Backfill Existing Uploads

After creating the `GSI1` index in DynamoDB, run a dry-run backfill first:

```bash
python3 backend/scripts/backfill_upload_gsi.py --dry-run
```

If your AWS access uses a named profile:

```bash
python3 backend/scripts/backfill_upload_gsi.py --dry-run --profile your-profile
```

Then run the real write:

```bash
python3 backend/scripts/backfill_upload_gsi.py
```
