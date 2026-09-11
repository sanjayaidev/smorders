# Simit Astana Orders

Node.js/Express order server with WhatsApp and Instagram DM bots, an admin dashboard, Supabase persistence, and Meta webhook receivers.

## Requirements

- Node.js 18 or newer
- A Supabase project
- A Meta developer app for WhatsApp and/or Instagram
- A public HTTPS URL for production webhooks

## Install and run

```bash
npm install
npm start
```

For local development:

```bash
npm run dev
```

The server listens on `PORT` (default `3000`). The health check is `GET /health`.

## Environment variables

Create a `.env` file in the project root. Never commit it.

### Required

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL, such as `https://project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service-role key. Do not expose it in browser code. |
| `ADMIN_PASS` | Password used by all admin dashboard login screens and protected admin API requests. |

### Webhook verification

Meta sends `hub.verify_token` during the webhook handshake. Set a separate token per channel, or use the shared fallback:

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp webhook verification token |
| `INSTAGRAM_VERIFY_TOKEN` | Instagram webhook verification token |
| `META_VERIFY_TOKEN` | Fallback token for Instagram when `INSTAGRAM_VERIFY_TOKEN` is not set |

The verify token must exactly match the value entered in Meta's webhook configuration.

### WhatsApp

These values can be configured here or through the admin WhatsApp connection page. Database values take precedence for connection credentials.

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_WABA_ID` | WhatsApp Business Account ID |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID |
| `WHATSAPP_TOKEN` | Page/system-user access token used to send messages |
| `WHATSAPP_APP_SECRET` | Meta app secret used to validate `X-Hub-Signature-256` |
| `WHATSAPP_API_VERSION` | Graph API version; defaults to `v21.0` |

### Instagram

Manual connection values can be configured through the admin Instagram page. The OAuth login button additionally requires the app credentials below.

| Variable | Purpose |
| --- | --- |
| `INSTAGRAM_PAGE_ID` | Facebook Page ID used to send Instagram DMs |
| `INSTAGRAM_USER_ID` | Instagram professional account ID |
| `INSTAGRAM_TOKEN` | Page access token used to send messages |
| `INSTAGRAM_APP_SECRET` | Meta app secret used to validate webhook signatures and Instagram OAuth login |
| `INSTAGRAM_APP_ID` | Meta app ID used by Instagram OAuth login |
| `IG_APP_ID` | Alternative OAuth app ID name |
| `IG_SECRET` | Alternative OAuth app secret name |
| `FACEBOOK_APP_ID` | Fallback OAuth app ID |
| `FACEBOOK_APP_SECRET` | Fallback OAuth app secret |
| `APP_BASE_URL` | Public base URL used to build the OAuth callback URL |

For production OAuth, set `APP_BASE_URL` to `https://smorder.up.railway.app`.

### Optional services

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; defaults to `3000` |
| `FRONTEND_ORIGIN` | CORS origin; defaults to `*` |
| `IMGBB_API_KEY` | Enables admin image uploads |
| `ALIBABA_API_KEY` | Enables the assistant service |
| `ALIBABA_MODEL` | Assistant model; uses the provider default when unset |
| `ALIBABA_REGION` | Alibaba API region |
| `ALIBABA_WORKSPACE_ID` | Alibaba workspace ID |

## Supabase setup

Run every SQL migration in `supabase/migrations/` in filename order. The migrations create the order lifecycle, WhatsApp and Instagram bot tables, connection rows, and `webhook_events`.

The `webhook_events` table is important: it stores every webhook POST, including Meta dashboard tests, status-only updates, zero-message payloads, failed signature checks, and processing errors.

## Meta webhook setup

Use either the reference-compatible paths or the existing paths:

| Channel | Recommended callback URL |
| --- | --- |
| WhatsApp | `https://smorder.up.railway.app/webhooks/whatsapp` |
| Instagram | `https://smorder.up.railway.app/webhooks/instagram` |

The old `/api/whatsapp/webhook` and `/api/instagram/webhook` paths remain supported.

Set the corresponding verify token in Meta. Subscribe to the message field for the channel. In production, also configure the matching app secret so inbound signatures are verified.

Webhook POSTs are acknowledged immediately with `200 OK`, then processed and logged. A payload with no messages is marked `is_test: true` in `webhook_events`; this includes Meta's Test button and status-only events.

## Instagram OAuth login

1. Set `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` (or the documented aliases).
2. Set `APP_BASE_URL` to the public site URL.
3. Add this exact callback URL to the Meta app:

   `https://smorder.up.railway.app/api/auth/instagram/callback`

4. Open `/admin/instagram.html`, sign in with `ADMIN_PASS`, and choose **Log in with Instagram**.

The protected endpoint `GET /api/admin/instagram/auth-url` creates the signed OAuth state. The public callback exchanges the code, finds the first Facebook Page linked to an Instagram professional account, and saves that connection in `ig_connection`.

## Admin pages and API

- `/admin/index.html` - orders, products, and categories
- `/admin/whatsapp.html` - WhatsApp connection and bot settings
- `/admin/instagram.html` - Instagram connection and bot settings
- `/admin/webhooks.html` - persisted webhook event log
- `POST /api/admin/login` - admin login, returns a bearer token

Protected admin requests use:

```http
Authorization: Bearer <ADMIN_PASS>
```
