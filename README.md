# 24/7Support

A multi-workspace customer-support app with an embeddable widget, staff inbox, saved replies, personal light/dark/system appearance, workspace branding, optional team AI and signed outbound webhooks.

## Current launch status

The application is running locally, not yet on a verified public production host. The public Whop product is https://whop.com/the-modern-communication-academy/24-7support. Public listing visibility does not mean automatic workspace provisioning is connected. Before inviting paying customers, finish hosting, SMTP, Whop credentials and plan mappings, then verify a real checkout and signed webhook grant. `npm run check:launch` checks configuration presence, not email delivery or payments.

## Development and verification

Use Node 22. Run `npm ci`, `npm ci --prefix client`, then `npm run dev`. Open http://localhost:5173 and /admin; the backend listens on port 4000. Copy `.env.example` to `.env` for server settings. Local defaults are admin@example.com / admin12345; production refuses these defaults. Never publish `.env`, customer SQLite files, logs or backups.

Run `npm test` for tenant isolation, authentication/recovery, realtime inbox, billing, appearance and integration checks. Run `npm run build` for production assets; `npm start` serves API and built client together. Provider requests are mocked in automated tests; real customer AI credentials have not been exercised.

## Customer workspaces and inbox

Registration creates a separate workspace, widget key and administrator. Admins manage teammates; agents cannot change workspace secrets or integrations. Backend limits are enforced: Free has 1 seat and 50 conversations/month; Starter has 3 seats and 500; Growth has 8 seats and 2,000; Partner has 20 seats and 10,000. Growth and Partner include optional AI drafts. Paused workspaces cannot use the widget.

The inbox supports search, open/pending/closed status, attachments, per-agent unread state, saved replies, socket reconnection and durable polling catch-up. Enable and test sound with a user gesture; browser autoplay rules require this. Desktop notifications require permission and the app open. Closed-browser push notifications are not implemented. Type `/` in the composer to search saved reply titles; Enter or Tab inserts the first match, and Escape clears the shortcut. Inserting a saved reply does not send it.

## Appearance and widget installation

Light, Dark and System appearance are personal settings saved in the browser, with system changes and cross-tab updates respected. Workspace branding offers preset colors and up to eight named custom themes. Widget colors belong to the workspace and are independent of the staff member's personal appearance.

Copy the install script from workspace settings:

```html
<script src="https://your-domain.com/widget.js" data-key="your-widget-key"></script>
```

Use `/widget-demo?key=YOUR_KEY` to test the embed. Treat widget keys as public installation identifiers; staff APIs require authentication. Rotate a compromised widget key in settings.

## Password recovery

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM`. Port 465 uses implicit TLS; other configured ports require STARTTLS. Gmail can use smtp.gmail.com with an app password; common transactional providers can use their SMTP credentials. Configure `APP_URL` to the public HTTPS origin so reset links point to the correct host. Password reset uses hashed single-use tokens with 30-minute expiry and revokes existing sessions. No reset link is logged. Missing SMTP returns an honest unavailable message. Verify delivery to a real mailbox before launch.

## Team AI

Workspace admins connect their own OpenAI, Anthropic or Google Gemini account under Settings > Integrations, enter an available model ID, and explicitly enable drafts. No operator/global API key is used as a fallback. Provider usage is billed to the team's own provider account. An agent's draft request sends the latest 12 message texts, capped at 24,000 characters, without attachments, to the selected provider. Agents review drafts before sending. Provider errors surface as errors, never fabricated fallback AI output.

Set `INTEGRATION_ENCRYPTION_KEY` to a random 32-byte hexadecimal value on the server before accepting team API keys. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. API keys are encrypted with AES-256-GCM, never returned in settings responses, and removed on disconnect. Preserve the encryption key securely with database backups. Changing or losing it requires teams to reconnect their providers. Never put it in a VITE_ variable.

## Team webhooks

Workspace admins can add up to five public HTTPS endpoints on port 443 with IPv4 support. Supported events are `conversation.created`, `conversation.updated` and `message.created`. Message events contain customer/agent text; connect only team-authorized destinations. Private addresses, redirects and DNS rebinding are blocked by resolving and pinning public IPv4 addresses per connection.

The signing secret is shown once when an endpoint is added. Verify `X-Support-Signature` as `v1=` plus HMAC-SHA256(secret, `X-Support-Timestamp + "." + rawBody`). Reject stale timestamps and deduplicate `X-Support-Event-Id`. The database-backed queue retries failures up to six times with exponential backoff. Delivery metadata is visible in settings. Delivery is at least once for queued events. Each endpoint has a 1,000 pending-event cap; additional events are dropped while that cap is reached. Completed/failed payloads expire after seven days. Keep the database and backups private: they include customer messages and encrypted webhook signing credentials. Removing an endpoint also removes its queued deliveries.

## Whop payments and owner access

Use the Modern Communication Academy business, not Alphabot. Configure `WHOP_ENVIRONMENT`, `WHOP_API_KEY`, `WHOP_ACCOUNT_ID`, `WHOP_WEBHOOK_SECRET` and the three `WHOP_*_PLAN_ID` mappings. Start with sandbox testing; production business plans must be paired with production credentials and environment. Automatic checkout stays disabled when required configuration or the public production HTTPS URL is missing.

The backend creates checkout configurations with server-owned order metadata. Register `/api/webhooks/whop` as the Whop webhook endpoint. Signatures, API version, business account, payment status, plan, order and current membership are checked before access changes. Events deduplicate and retry; cancellations reconcile current membership. The owner-only `/owner` page shows billing events, failures and audited manual plan adjustments. Customer billing controls show purchase/payment options without owner approval internals.

## Production operations

`render.yaml` describes a single Node service with a persistent disk at `/var/data`, database `/var/data/support.sqlite`, health check `/health`, and manual deployment. Configure strong unique administrator credentials, owner email, stable integration encryption key, SMTP and Whop values in hosting secrets. `APP_URL` must be the public HTTPS origin; Render can supply it from `RENDER_EXTERNAL_URL`. If serving the client separately, set allowed origins with `CLIENT_URLS` and build with `VITE_API_URL`. Configure `TRUST_PROXY_HOPS` only to match the actual trusted proxy chain.

Run `npm run backup` for an online SQLite backup; keep backups outside the public web root and verify restores. SQLite WAL mode supports this single-instance deployment; move to a shared database and queue before horizontal scaling. Real mail delivery, payment checkout, webhook recovery, persistent-disk restoration and a public browser test are required launch checks. Avoid relying only on environment presence or mocked tests as proof of production readiness.


## Isolated customer pilot

Run `npm run build` and then `npm run pilot`. Keep the terminal running while testing:

- Customer website: http://localhost:4174
- Isolated staff inbox: http://localhost:4100/admin
- Pilot login: `.sandbox/LOGIN.txt` (created on startup; do not publish it)

The sample Northline store has conversation scenarios, FAQs and a manual eight-step test checklist. It loads the actual embedded widget from a separate origin. Its backend binds only to loopback and stores test data in `.sandbox/pilot.sqlite`, separate from the main support database. The pilot workspace has Partner limits for trying team features; this is test access, not a Whop purchase. SMTP, billing credentials, Discord alerts and operator AI keys are disabled by the launcher. Teams can optionally connect their own AI provider; doing so makes real provider calls and incurs their provider's charges.

Both sites persist data between runs. Ctrl+C stops both. Restarting does not erase tests. If ports are occupied, set `PILOT_API_PORT` and `PILOT_SITE_PORT` to unused ports. The site's static server serves only its named public files and public runtime identifiers; credentials and SQLite are never served. `npm run pilot` does not publish an Internet-accessible website. A shareable Alphabot pilot still needs a public host, secure credentials and the production launch checks above.

The embedded widget supports isolated Shadow DOM styling, customer identity/draft recovery during refreshes of message content, image attachments, automatic message polling, retry indicators, accessible controls and storage-denied sessions. Client request IDs deduplicate retries of the same widget send. Conversation persistence across page refresh requires browser storage; unsent drafts persist in memory during the current visit. Browser checks confirmed first message, staff reply without refresh and preservation of an unsent draft. Browser image-upload verification was interrupted by the browser connection; it still needs a manual pilot check.
