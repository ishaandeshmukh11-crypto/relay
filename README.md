# TWWIOS Relay

WhatsApp campaigns from one Excel sheet.

Relay lets a business connect a WhatsApp Business number, import consented contacts, send approved template campaigns in controlled batches, track delivery/reads/replies, handle STOP/opt-out, and optionally wire Instagram/Facebook comment-to-message. USD checkout via Stripe is supported; INR (Razorpay) stays gated until prices are approved.

**Not included in this package:** Mira handoff, shared multi-agent TWWIOS shell, and the absent `design/website-final.html` marketing design.

Requires **Node.js 24** (see `.nvmrc`). Frontend: Next.js **16.4.5** + React 19. Backend: Express + MongoDB. Validation: Zod **4.6.7**.

Product PDFs in this repo:
- `TWWIOS-Relay-Guide.pdf` — product, process, pricing, sales
- `TWWIOS-Relay-Developer-Handbook.pdf` — architecture, keys, extensions

---

## Architecture

```
Browser / Vercel (code/web)
        │  /api/* rewrite
        ▼
Render API (code/api)  ──►  MongoDB Atlas
        │
        ├── Meta WhatsApp / Graph
        ├── Stripe (USD) / Razorpay (INR, gated)
        └── Resend (email)
```

Campaign sending runs inside the API process via an in-process scheduler (`startScheduler`). One Render web service is enough; no separate worker service is required for the current design.

API routes are mounted at **`/api/relay`**. Legacy **`/api/pulse`** remains as a compatibility alias for existing Meta/Stripe webhook configurations.

---

## Directory structure

```
.
├── code/
│   ├── api/                 # Express API (Render)
│   │   ├── relay/           # Domain modules (auth, campaigns, WA, billing, …)
│   │   ├── tests/           # Automated API suites
│   │   ├── server.js
│   │   └── Dockerfile
│   └── web/                 # Next.js App Router (Vercel)
│       ├── app/
│       ├── components/
│       ├── lib/
│       ├── tests/
│       ├── vercel.json
│       └── Dockerfile
├── scripts/                 # mongodump / mongorestore helpers
├── staging/                 # Staging env + Caddy examples
├── docs/                    # Design notes (e.g. REL-26 shell plan)
├── design/                  # Sample HTML reference
├── .github/workflows/ci.yml
├── docker-compose.staging.yml
├── render.yaml
├── DEPLOY.md
├── ENVIRONMENT.md
└── README.md
```

---

## Core features

- Company signup, email verification, password reset
- WhatsApp connect (token or Embedded Signup when Meta config is set)
- Consent-attested contact import with E.164 / explicit country
- Approved-template campaigns with canary + rate limiting
- Uncertain Meta sends marked `unknown` (not auto-retried)
- Inbound webhooks with HMAC, durable inbox, duplicate prevention
- STOP / opt-out and keyword rules
- Stripe USD subscriptions; Razorpay INR when approved
- Org-scoped API keys for `/api/relay/v1/send`
- Account deletion + Meta data-deletion callback
- Optional Instagram/Facebook comment flows (Meta permissions required separately)

---

## Local development

### Requirements

- Node.js **24.x**
- MongoDB (local or Atlas). For a disposable local trial without MongoDB: `RELAY_ALLOW_MEMORY=1` (non-production only)

### Install

```bash
cd code/api && npm ci
cd ../web && npm ci
```

### Environment

```bash
cp code/api/.env.example code/api/.env
cp code/web/.env.example code/web/.env.local
# Fill AUTH_SECRET, ENC_KEY, MONGODB_URI, etc. See ENVIRONMENT.md
```

### Run

```bash
# Terminal 1 — API
cd code/api && npm start          # http://localhost:4000/health

# Terminal 2 — Web
cd code/web && npm run dev        # http://localhost:3000  and /app
```

Web rewrites `/api/*` to `API_URL` (default `http://localhost:4000`).

### Tests

```bash
cd code/api && npm test           # tests/auth|admin|billing|social|durability|policy|contacts|unit
cd code/web && npm test           # product/scope smoke
```

Set `BATCH1_MONGO` / `BATCH2_MONGO` / `BATCH3_MONGO` when using a shared Mongo for durable API suites.

### Production build (web)

```bash
cd code/web
npm ci
npm run build
npm start
```

### Audit

```bash
cd code/api && npm audit --omit=dev
cd code/web && npm audit --omit=dev
```

---

## Deployment overview

| Layer | Host | Root directory |
| --- | --- | --- |
| Frontend | **Vercel** | `code/web` |
| Backend | **Render** | `code/api` |
| Database | **MongoDB Atlas** | dedicated Relay DB |

Full variable list: [`ENVIRONMENT.md`](./ENVIRONMENT.md).  
Ops detail: [`DEPLOY.md`](./DEPLOY.md).

### Vercel (frontend)

1. Import this GitHub repo into Vercel.
2. **Root Directory:** `code/web`
3. Framework: Next.js (auto). Install: `npm ci`. Build: `npm run build`.
4. Set `API_URL` to your Render API origin (e.g. `https://twwios-relay-api.onrender.com`) for **Production** and Preview as needed.
5. Optional: `NEXT_PUBLIC_*` company fields for legal pages.
6. Attach your production domain.

Do not put backend secrets in Vercel.

### Render (backend)

1. New Web Service from this repo, **Root Directory** `code/api`, or use `render.yaml`.
2. Runtime: Node. Build: `npm ci`. Start: `npm start`.
3. Health check: `/health`.
4. Set production env vars from `ENVIRONMENT.md` (especially Mongo, auth, Meta, Resend, CORS/`PUBLIC_URL` pointing at the Vercel domain).
5. Configure Meta/Stripe/Razorpay webhook URLs against the Render hostname under `/api/relay/...`.

Background campaign ticks run in this same process.

### MongoDB Atlas

1. Create cluster + database user.
2. Network access for Render.
3. Connection string → Render `MONGODB_URI`.
4. On boot, Relay creates unique indexes (`users_email`, `contacts_org_phone`, `wa_inbound_meta`, `webhook_inbox_key`, …).
5. Backups: `scripts/backup-mongo.sh` / `.ps1` (directory format). Never restore over production without separate authorization.

---

## External integrations

| Service | Notes |
| --- | --- |
| Meta WhatsApp | Test/live app, WABA, HMAC with `WA_APP_SECRET`, approved templates |
| Stripe | Test then live keys + price ids |
| Razorpay | Only after `INR_PRICES_APPROVED=1` and approved INR amounts |
| Resend | Verified sending domain |
| Sentry | Optional DSN reserved; SDK wiring is a follow-up |

Local automated tests use mocks. They are **not** proof of live provider wiring.

---

## Security notes

- Production refuses memory store and missing critical secrets.
- WhatsApp tokens encrypted at rest with `ENC_KEY`.
- Webhook signatures verified before processing.
- Uncertain sends → `unknown`, never blind-retried.
- Sessions tied to `tokenVersion` (password change invalidates old tokens).
- Org data isolation on every query path.
- Legal pages are scaffolds until counsel fills company facts.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| API exits immediately | Production env validation / Mongo connection (`/health` → `db`) |
| Web `/api` 502 | `API_URL` on Vercel points at Render; CORS/`PUBLIC_URL` match web origin |
| Meta webhook 401 | `WA_APP_SECRET` / verify token; path `/api/relay/webhook` |
| Emails not sent | Resend key + verified `MAIL_FROM` domain |
| Tokens fail after redeploy | `ENC_KEY` changed |
| INR checkout blocked | Expected until INR approval flag + plans |

---

## Contributing / GitHub

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local workflow. Do not commit `.env` files or secrets.
