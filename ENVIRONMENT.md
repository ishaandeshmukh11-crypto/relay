# Environment variables — TWWIOS Relay

Placeholders only. Put real values in Vercel, Render, or your secret manager — never in git.

## Backend (`code/api`) — Render dashboard

| Name | Required | Sensitive | When | Purpose |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | yes (prod) | no | runtime | Set `production` on Render |
| `HOST` | recommended | no | runtime | Bind address; default `0.0.0.0` |
| `PORT` | yes (host) | no | runtime | Render injects; app defaults to `4000` |
| `MONGODB_URI` | yes (prod) | **yes** | runtime | Atlas connection string |
| `AUTH_SECRET` | yes (prod) | **yes** | runtime | Session HMAC (≥32 chars) |
| `ENC_KEY` | yes (prod) | **yes** | runtime | WhatsApp/social token encryption (≥32 chars). Changing invalidates stored tokens |
| `PUBLIC_URL` | yes (prod) | no | runtime | Public website origin (no trailing slash); used in email links |
| `CORS_ORIGIN` | yes (prod) | no | runtime | Comma-separated allowed web origin(s); required in production startup gate |
| `WA_APP_SECRET` | yes (prod) | **yes** | runtime | Meta app secret for WhatsApp HMAC |
| `WA_VERIFY_TOKEN` | yes (prod) | **yes** | runtime | Meta webhook verify token; required in production startup gate |
| `SOCIAL_VERIFY_TOKEN` | optional | **yes** | runtime | Social webhook verify; falls back to `WA_VERIFY_TOKEN` |
| `STRIPE_BASE` / `RAZORPAY_BASE` / `RESEND_BASE` | test/optional | no | runtime | Override provider API bases (tests/mocks) |
| `DEMO_FAST` | local/test only | no | runtime | Speeds canary waits in non-prod demos |
| `RELAY_ALLOW_LOCAL_PROVIDERS` | test only | no | runtime | Allows `http://127.0.0.1` Graph/Stripe/Razorpay/Resend bases when `NODE_ENV=production` in automated tests. **Never set in real production.** |
| `RESEND_API_KEY` | yes (prod) | **yes** | runtime | Transactional email |
| `MAIL_FROM` | yes (prod) | no | runtime | Verified From address |
| `FB_APP_ID` | optional | no | runtime | Embedded Signup / social connect |
| `FB_APP_SECRET` | optional | **yes** | runtime | Meta app secret for FB flows |
| `WA_CONFIG_ID` | optional | no | runtime | Embedded Signup config id |
| `GRAPH_BASE` | optional | no | runtime | Default Graph API base |
| `RELAY_RATE` | optional | no | runtime | Campaign send rate (msg/tick window); default 20 |
| `PULSE_RATE` | legacy alias | no | runtime | Read only if `RELAY_RATE` unset |
| `TICK_MS` | optional | no | runtime | Scheduler interval ms |
| `CANARY_WAIT_MS` | optional | no | runtime | Canary wait before full send |
| `WA_FETCH_TIMEOUT_MS` | optional | no | runtime | Meta HTTP timeout |
| `BILLING_CURRENCY` | optional | no | runtime | `USD` (default) or `INR` |
| `BILLING_GRACE_DAYS` | optional | no | runtime | Past-due grace; default 3 |
| `STRIPE_SECRET_KEY` | for USD checkout | **yes** | runtime | Stripe secret |
| `STRIPE_WEBHOOK_SECRET` | for USD webhooks | **yes** | runtime | Stripe signing secret |
| `STRIPE_PRICE_*` | for USD checkout | no | runtime | Stripe price ids (starter/growth × month/year) |
| `INR_PRICES_APPROVED` | for INR | no | runtime | Must be `1` to enable Razorpay checkout |
| `RAZORPAY_*` | for INR | **yes** | runtime | Keys, webhook secret, plan ids |
| `PRICE_STARTER` / `PRICE_GROWTH` | INR display | no | runtime | Unapproved placeholders until business confirms |
| `RELAY_ADMIN_KEY` | recommended | **yes** | runtime | Manual plan activation header |
| `PULSE_ADMIN_KEY` | legacy alias | **yes** | runtime | Accepted if `RELAY_ADMIN_KEY` empty |
| `SENTRY_DSN` | optional | **yes** | runtime | Reserved; wire SDK in a follow-up |
| `AUTH_RATE_LIMIT` | optional | no | runtime | Auth endpoint rate limit |
| `RELAY_ALLOW_MEMORY` | local only | no | runtime | `1` enables memory store; **refused in production** |
Startup validation in production refuses missing `AUTH_SECRET`, `ENC_KEY`, `MONGODB_URI`, `PUBLIC_URL`, `CORS_ORIGIN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `RESEND_API_KEY`, `MAIL_FROM`, and refuses `RELAY_ALLOW_MEMORY=1`.

### Webhook paths (API host)

| Provider | Path |
| --- | --- |
| WhatsApp | `POST /api/relay/webhook` (legacy: `/api/pulse/webhook`) |
| Social | `POST /api/relay/social/webhook` |
| Stripe | `POST /api/relay/billing/stripe/webhook` |
| Razorpay | `POST /api/relay/billing/webhook` |
| Meta data deletion | `POST /api/relay/meta/data-deletion` |

## Frontend (`code/web`) — Vercel dashboard

| Name | Required | Sensitive | When | Purpose |
| --- | --- | --- | --- | --- |
| `API_URL` | yes (prod) | no* | **build + runtime** | Origin of Render API for Next rewrites. Not a private key, but do not point at localhost in production |
| `NEXT_PUBLIC_COMPANY_*` | optional | no | build | Legal page facts only when counsel provides them |
| `NEXT_PUBLIC_DATA_DELETION_EMAIL` | optional | no | build | Contact email on data-deletion page |
| `NEXT_PUBLIC_SENTRY_DSN` | optional | public DSN | build | Browser Sentry only |

\* Never put `AUTH_SECRET`, `ENC_KEY`, Stripe secrets, or Resend keys in `NEXT_PUBLIC_*` or the Vercel frontend project.

## MongoDB Atlas

Create a dedicated cluster/database (e.g. `twwios_relay`). Restrict network access to Render egress IPs (or `0.0.0.0/0` only during bootstrap). Put the URI only in Render as `MONGODB_URI`.

## Local examples

- `code/api/.env.example`
- `code/web/.env.example`
- `staging/.env.staging.example`
