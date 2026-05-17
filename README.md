# 24/7Support

A downloadable Intercom-style support system for projects and companies. It includes an embeddable widget, a secured staff dashboard, project-level widget keys, theme settings, automation templates, realtime messaging, and basic AI-assisted support replies.

## Features

- Multi-project foundation with project records and widget keys
- Standalone widget script: `<script src="https://your-domain.com/widget.js" data-key="..."></script>`
- Secured agent support inbox with email/password login
- Theme settings for brand name, colors, greeting, reply-time text, and widget position
- Basic AI reply drafts using `OPENAI_API_KEY`, with local rule-based fallback
- Realtime messages using Socket.io
- SQLite database
- Open / Pending / Closed conversation status
- Customer metadata: name, email, wallet, page URL
- Optional Discord webhook alert for new conversations
- Editable automation templates and auto-replies

## Setup

```bash
npm run install:all
npm run dev
```

Open:

- Customer widget demo: `http://localhost:5173`
- Agent inbox: `http://localhost:5173/admin`

Backend runs on:

- `http://localhost:4000`

Default local admin:

```txt
Email: admin@example.com
Password: admin12345
```

Set real credentials before deploying:

```env
PORT=4000
CLIENT_URL=http://localhost:5173
CLIENT_URLS=http://localhost:5173,https://your-domain.com
DATABASE_PATH=./support.sqlite
ADMIN_EMAIL=owner@your-company.com
ADMIN_PASSWORD=use-a-long-password
OPENAI_API_KEY=
DISCORD_WEBHOOK_URL=
```

## Widget install

After logging in to `/admin`, copy the install script from the Project panel:

```html
<script src="https://your-domain.com/widget.js" data-key="your-widget-key"></script>
```

The widget key tells the backend which project owns the conversation, so messages from different companies do not mix.

## VPS install

```bash
git clone your-repo
cd support-chat-mvp
npm run install:all
npm run build
npm start
```

For a VPS, put the app behind Nginx or Caddy, set HTTPS, and use a process manager such as PM2 or systemd.

## Production notes

On Vercel, set the client environment variables:

```bash
VITE_API_URL=https://your-render-service.onrender.com
VITE_WIDGET_KEY=your-widget-key
```

The deployed agent inbox is:

```bash
https://your-vercel-domain.vercel.app/admin
```

On Render, set either `CLIENT_URL` to your Vercel site URL, or `CLIENT_URLS` to a comma-separated list if you need both preview and production domains.

For larger production use, replace SQLite with PostgreSQL or Supabase, add invite-based staff management, and store widget assets behind your final domain.
