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

On Vercel, set the client environment variable:

```bash
VITE_API_URL=https://your-render-service.onrender.com
```

The deployed agent inbox is:

```bash
https://your-vercel-domain.vercel.app/admin
```

On Render, set either `CLIENT_URL` to your Vercel site URL, or `CLIENT_URLS` to a comma-separated list if you need both preview and production domains.

For production, replace SQLite with PostgreSQL or Supabase, add authentication for `/admin`, and restrict CORS to your real domain.
