# StrideAI Dashboard Demo (Next.js)

Demo frontend scaffold for:

- PI login using `PI_ID` + password
- Listing projects (studies) under the logged-in PI
- Listing subjects (participants) under each project

This is a mock-data frontend only (no backend integration yet).

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Demo Credentials

- `PI_1001` / `stride123`
- `PI_2001` / `stride456`

## Notes

- Session is stored in browser `localStorage`.
- Data is mocked in `lib/demoData.js`.
- Auth helpers are in `lib/demoAuth.js`.
