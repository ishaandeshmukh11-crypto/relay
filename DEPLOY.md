# Relay deployment

## Runtime targets

| Layer | Version |
| --- | --- |
| Node.js | **24.x** (`.nvmrc`, Docker `node:24-alpine`, CI) |
| Next.js | **16.4.5** |
| React | **19.x** |
| Zod | **4.6.7** |

## Topology

1. **Vercel** — `code/web`
2. **Render** — `code/api` (in-process campaign scheduler)
3. **MongoDB Atlas** — dedicated Relay database

See `ENVIRONMENT.md` and `render.yaml`.

## Vercel

| Setting | Value |
| --- | --- |
| Root Directory | `code/web` |
| Install / Build | `npm ci` / `npm run build` |
| Required env | `API_URL` = Render API origin |

## Render

| Setting | Value |
| --- | --- |
| Root Directory | `code/api` |
| Build / Start | `npm ci` / `npm start` |
| Health check | `/health` |
| Bind | `HOST=0.0.0.0` |

Webhook paths (API host):

- WhatsApp: `/api/relay/webhook` (legacy `/api/pulse/webhook`)
- Stripe: `/api/relay/billing/stripe/webhook`
- Razorpay: `/api/relay/billing/webhook`
- Social: `/api/relay/social/webhook`

## Docker (optional)

```bash
cp staging/.env.staging.example staging/.env.staging
docker compose -f docker-compose.staging.yml build && up -d
```

## Backups

```bash
./scripts/backup-mongo.sh "$MONGODB_URI" ./backups
./scripts/restore-mongo.sh "mongodb://STAGING_HOST:27017" ./backups/relay-YYYYMMDD-HHMMSS
```

Never restore over production without separate authorization.

## Unknown WhatsApp sends

Uncertain Meta outcomes become `unknown` and are **not** auto-retried.
