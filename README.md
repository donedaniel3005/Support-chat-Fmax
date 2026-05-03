# Support Chat MVP

A simple Intercom-style support system you can run locally.

## Features

- Customer chat widget
- Agent support inbox
- Realtime messages using Socket.io
- SQLite database
- Open / Pending / Closed conversation status
- Customer metadata: name, email, wallet, page URL
- Optional Discord webhook alert for new conversations
- Canned reply area can be added easily

## Setup

```bash
npm run install:all
cp .env.example .env
npm run dev
```

Open:

- Customer widget demo: `http://localhost:5173`
- Agent inbox: `http://localhost:5173/admin`

Backend runs on:

- `http://localhost:4000`

## Production notes

For production, replace SQLite with PostgreSQL or Supabase, add authentication for `/admin`, and restrict CORS to your real domain.
