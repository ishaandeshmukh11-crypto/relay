# Contributing to TWWIOS Relay

## Setup

1. Node 24 (`.nvmrc`).
2. `cd code/api && npm ci` and `cd code/web && npm ci`.
3. Copy `.env.example` files; never commit secrets.

## Checks

```bash
cd code/api && node --check server.js && node --check relay/routes.js && npm test
cd code/web && npm run build && npm test
cd code/api && npm audit --omit=dev
cd code/web && npm audit --omit=dev
```

## Conventions

- Canonical API prefix: `/api/relay` (legacy `/api/pulse` aliases remain).
- Do not rename Mongo collections without a migration plan.
- Do not invent legal copy, INR prices, or Mira features.
