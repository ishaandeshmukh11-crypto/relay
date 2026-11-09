# TWWIOS Relay — Code Quality Audit Report

**Date:** 2026-11-08  
**Decision:** **CODEBASE READY FOR GITHUB AND DEPLOYMENT CONFIGURATION**

No GitHub push. No deploy. Docker **NOT TESTED**. Live Meta/Stripe/Resend/Atlas **NOT TESTED** (mocks ≠ live).

---

## 1. Overall readiness

Code-level automated suites pass after structure refactor and production startup tightening. Repository docs/scripts restored. Professional `tests/` layout. Safe to push privately and configure Vercel/Render/Atlas with real secrets.

## 2–7. Test results

| Suite | Status |
| --- | --- |
| `tests/auth.test.mjs` | **PASS** |
| `tests/admin.test.mjs` | **PASS** |
| `tests/billing.test.mjs` | **PASS** |
| `tests/social.test.mjs` | **PASS** |
| `tests/durability.test.mjs` | **PASS** (incl. legacy `/api/pulse`) |
| `tests/policy.test.mjs` | **PASS** |
| `tests/contacts.test.mjs` | **PASS** |
| `tests/unit.test.mjs` | **PASS** |
| `tests/security.test.mjs` | **PASS** (security audit regressions) |
| `code/web` `npm test` | **PASS** |
| `code/web` `npm run build` | **PASS** |
| API/web `npm audit --omit=dev` | **PASS** (0 vulns) |
| Docker builds | **NOT TESTED** |
| Live external integrations | **NOT TESTED** / **BLOCKED** on credentials |
| Manual browser E2E | **NOT TESTED** (out of scope) |
| Coverage report tooling | **NOT TESTED** (no coverage runner configured) |

**Tests added:** `tests/unit.test.mjs`, `tests/security.test.mjs`, `code/web/tests/product.test.mjs`  
**Tests fixed:** path/cwd after move to `tests/`; policy mail-redaction string; contacts prod env; local-provider flag for prod-mode mocks  
**Tests failed:** none after fixes  
**Tests blocked:** Docker, live providers

---

## API SECURITY & CORRECTNESS AUDIT

Completed in a fresh pass after the prior interrupted subagent. Commands:

```
cd code/api
node --check server.js relay/routes.js relay/billing.js relay/inbox.js relay/providers.js relay/auth.js relay/wa.js relay/social.js relay/mail.js
npm test
npm audit --omit=dev
```

Results: syntax OK · `npm test` **PASS** (incl. legacy `/api/pulse`) · audit **0** vulnerabilities.

### 1. Authentication and session handling
- **Files:** `relay/auth.js`, `relay/routes.js` (auth routes)
- **Findings:** `checkPw` could throw on malformed hashes; session used token `orgId`/`email` without rebinding to DB user.
- **Severity:** Medium
- **Fixes:** Hardened `checkPw` (try/catch, require salt+hash); `requireAuth` binds `uid/orgId/email/tv` from live user row; added `timingSafeEqualStr`.
- **Tests:** `tests/security.test.mjs`, `tests/auth.test.mjs`
- **Status:** **PASS**

### 2. Admin authorization
- **Files:** `relay/routes.js` (`/admin/plan`, `/admin/orgs`)
- **Findings:** Admin key compared with `!==` (timing leak); email not validated with `.email()`.
- **Severity:** Low–Medium
- **Fixes:** Timing-safe compare via `timingSafeEqualStr`; admin email Zod `.email()`.
- **Tests:** `tests/admin.test.mjs`, `tests/security.test.mjs`
- **Status:** **PASS**

### 3. Billing and payment logic
- **Files:** `relay/billing.js`, checkout routes in `routes.js`
- **Findings:** `checkout.session.completed` could throw when `org` was null (`org._id`); Stripe verify only kept one `v1` signature.
- **Severity:** High (null org crash) / Low (multi-v1)
- **Fixes:** Resolve org via `client_reference_id`/`metadata`/`stripeSubId` before update; reject `unknown_org`; verify any `v1` signature in header.
- **Tests:** `tests/billing.test.mjs`, `tests/security.test.mjs`
- **Status:** **PASS** (live Stripe **NOT TESTED**)

### 4. Stripe/Razorpay webhook HMAC + idempotency
- **Files:** `relay/billing.js`, `relay/inbox.js`, `relay/routes.js`
- **Findings:** Concurrent duplicate deliveries could both process while status was `pending`/`processing`.
- **Severity:** High
- **Fixes:** Shared `handleSignedWebhook` + atomic `claimWebhook()` before apply; in-flight duplicates return 200 without re-apply.
- **Tests:** `tests/billing.test.mjs`, `tests/security.test.mjs`
- **Status:** **PASS**

### 5. WhatsApp/Meta webhooks
- **Files:** `relay/routes.js`, `relay/events.js`, `relay/inbox.js`
- **Findings:** Same concurrent double-process race as above; HMAC already timing-safe.
- **Severity:** High (race)
- **Fixes:** Claim-before-process path; legacy `/api/pulse/webhook` still mounted.
- **Tests:** `tests/durability.test.mjs` (incl. legacy alias)
- **Status:** **PASS** (live Meta **NOT TESTED**)

### 6. Social endpoints / Graph
- **Files:** `relay/social.js`, `relay/wa.js`
- **Findings:** `GRAPH_BASE` env could point anywhere (SSRF if mis-set); social webhook lacked claim.
- **Severity:** Medium
- **Fixes:** `providers.js` allowlist; social webhook uses `claimWebhook`.
- **Tests:** `tests/social.test.mjs`, `tests/security.test.mjs`
- **Status:** **PASS**

### 7. Rate limiting and abuse protection
- **Files:** `server.js`, `routes.js` (`strict`, `apiLimit`, trigger 600/min)
- **Findings:** Outer `app.use("/api", rateLimit)` was registered **after** Relay mounts (ineffective).
- **Severity:** Low
- **Fixes:** Removed dead global limiter; documented router-owned limits. Webhooks stay outside `apiLimit` by design.
- **Status:** **PASS** (verified in final regression)

### 8. CORS / origin validation
- **Files:** `server.js`
- **Findings:** Origins after commas were not trimmed.
- **Severity:** Low
- **Fixes:** `.map(trim).filter(Boolean)`; production requires `CORS_ORIGIN`.
- **Status:** **PASS**

### 9. Input validation
- **Files:** Zod usage across `routes.js` / `social.js`
- **Findings:** Admin email lacked `.email()` (fixed). Broader Zod coverage already present on auth/billing/campaigns.
- **Status:** **PASS**

### 10. Database access / consistency
- **Files:** `store.js`, `indexes.js`, claim paths in `sender.js`/`inbox.js`
- **Findings:** Unique indexes + message/webhook claims already present; webhook claim gap fixed.
- **Status:** **PASS**

### 11. Secrets / sensitive data exposure
- **Files:** `mail.js`, error handler in `server.js`, health endpoint
- **Findings:** Reset URLs redacted in logs; 500s return generic message; health does not leak secrets.
- **Status:** **PASS**

### 12. Error handling / info leakage
- **Files:** `server.js` error middleware
- **Findings:** Acceptable generic client errors; server logs message only for 5xx.
- **Status:** **PASS**

### 13. SSRF / unsafe URL handling
- **Files:** `relay/providers.js`, `wa.js`, `social.js`, `billing.js`, `mail.js`
- **Findings:** Provider bases were unconstrained.
- **Severity:** Medium
- **Fixes:** Production allowlists Graph/Stripe/Razorpay/Resend hosts; local mocks need `RELAY_ALLOW_LOCAL_PROVIDERS=1` when `NODE_ENV=production` in tests.
- **Status:** **PASS**

### 14. File upload / path handling
- **Findings:** No file-upload endpoints in API (contacts via JSON).
- **Status:** **PASS** (N/A)

### 15. Background jobs / retries / duplicates
- **Files:** `sender.js`, `inbox.js`
- **Findings:** Uncertain Meta sends → `unknown` (no blind retry) already correct; webhook drain + new claim path.
- **Status:** **PASS**

### 16. Production fail-safes
- **Files:** `server.js`
- **Findings:** Already refuses missing secrets/memory store; now also `CORS_ORIGIN` + `WA_VERIFY_TOKEN`.
- **Status:** **PASS**

### 17. Legacy `/api/pulse` boundaries
- **Files:** `server.js` dual mounts
- **Findings:** Same router/auth as `/api/relay` (no weaker alias).
- **Tests:** durability legacy webhook assertion
- **Status:** **PASS**

### Remaining risks (not defects / external)
| Risk | Status |
| --- | --- |
| Live Meta/Stripe/Resend/Atlas | **NOT TESTED** — needs credentials |
| Docker image builds | **NOT TESTED** |
| Sentry SDK not wired | **NEEDS REVIEW** (DSN reserved only) |

---

## FINAL SECURITY REGRESSION & REMAINING GAP VERIFICATION

**Date:** 2026-11-08 (follow-up)

### 1. Webhook claim and recovery — **PASS**

Reviewed: `relay/inbox.js` (`claimWebhook`, `failWebhook`, `completeWebhook`, `drainInbox`), `handleSignedWebhook` in `routes.js`, social webhook path.

| Check | Result |
| --- | --- |
| Concurrent duplicate deliveries cannot both claim | **PASS** — second `claimWebhook` returns null |
| Successful event permanently `done` | **PASS** — `completeWebhook`; done rows not reclaimable |
| Failed event returns to `pending` for retry | **PASS** — after fix, attempts not double-counted |
| Crash after claim not permanently stuck | **PASS** — stale `claimUntil` reclaimed by `claimWebhook` / `drainInbox` |
| Dead after 5 failed claims | **PASS** — not reclaimable |
| Retry cannot weaken idempotency | **PASS** — unique inbox key; Stripe re-apply idempotent; WA inbound dedup via `wa_inbound` |

**Fix made:** `failWebhook` no longer `$inc`s attempts again (claim already counted). Prevented premature `dead` after ~2–3 real tries.

**Tests added/extended in `tests/security.test.mjs`:** concurrent claim, fail→retry→done, stale recovery, dead after 5, done not reclaimable, Stripe re-apply.

### 2. Express rate limiter ordering — **PASS**

Reviewed: `server.js`, `relay/routes.js`.

| Layer | Behavior |
| --- | --- |
| Former `app.use("/api", rateLimit…)` after mounts | Was **dead** for Relay routes |
| Auth routes | `strict` (15m / `AUTH_RATE_LIMIT`) |
| Webhooks / billing / social public | **Before** `apiLimit` (intentionally not throttled by app limiter) |
| Admin, config, authenticated app | `apiLimit` (60s / 300) |
| `/api/relay/v1/send` | triggerRouter 60s / 600 |

**Fix made:** Removed ineffective global `/api` limiter from `server.js` (would either miss mounts or throttle Meta/Stripe if moved before). Documented router-owned limits in source comment. No duplicate limiters added.

**Regression:** security test asserts no `app.use("/api", rateLimit` and that webhooks appear before `r.use(apiLimit)`.

### 3. Security fix coverage — **PASS**

| Fix | Covered by |
| --- | --- |
| Atomic webhook claims | security.test concurrent + recovery cases |
| Stripe missing org | `unknown_org` + successful `client_reference_id` |
| SSRF provider allowlist | production reject evil/localhost; local flag |
| Timing-safe admin compare | `timingSafeEqualStr` unit asserts |
| DB-backed session identity | spoofed orgId/email in JWT → live user fields; bad `tv` → 401 |
| Invalid password hash | `checkPw` returns false |
| CORS whitespace | `parseCorsOrigins` (+ empty/whitespace fallback) |
| Multiple Stripe `v1` | multi-v1 accept; skew reject |

### 4. Final regression commands and results

```
cd code/api && node --check server.js && node --check relay/inbox.js && node --check relay/cors.js
cd code/api && npm test
cd code/api && npm audit --omit=dev
cd code/web && npm test
cd code/web && npm run build
cd code/web && npm audit --omit=dev
```

| Command | Result |
| --- | --- |
| API syntax checks | **PASS** |
| API `npm test` (9 suites incl. security) | **PASS** |
| API `npm audit --omit=dev` | **PASS** (0) |
| Web `npm test` | **PASS** |
| Web `npm run build` | **PASS** |
| Web `npm audit --omit=dev` | **PASS** (0) |
| Docker | **NOT TESTED** |
| Live integrations | **NOT TESTED** |

### 5. Remaining known limitations

- Live Meta/Stripe/Resend/Atlas still **NOT TESTED** (mocks ≠ live).
- Docker builds **NOT TESTED**.
- Sentry SDK still reserved-only.
- Billing webhook retries re-run apply functions; they are written to be idempotent set-state, but live provider edge cases remain **NOT TESTED**.
- Webhooks intentionally lack the app `apiLimit` (provider delivery); rely on signature verification + claim/idempotency.

### Final code-level readiness

**CODEBASE READY FOR GITHUB AND DEPLOYMENT CONFIGURATION**

Webhook claim/recovery and rate-limit architecture verified with regression tests. Remaining gaps are external credentials/Docker/live E2E only.

## 8. Issues discovered and fixed

| Issue | Fix |
| --- | --- |
| Missing `DEPLOY.md`, `CONTRIBUTING.md`, `scripts/`, `staging/` examples, `docs/` | Restored |
| Unprofessional root-level `*test.mjs` names | Moved to `code/api/tests/*.test.mjs` |
| Production gate missing `CORS_ORIGIN` / `WA_VERIFY_TOKEN` | Added to `server.js` startup validation |
| Docs listed wrong Razorpay webhook path | Corrected to `/api/relay/billing/webhook` |
| `lib/api.js` used `/api` not `/api/relay` | Fixed helper |
| CI still pointed at old test filenames | Updated to `npm test` |
| Env docs incomplete vs code | Synced `ENVIRONMENT.md` + `.env.example` |

## 9. Remaining code-level issues / NEEDS REVIEW

| Item | Status |
| --- | --- |
| Sentry DSN reserved but SDK not wired | **NEEDS REVIEW** (documented) |
| Instagram/Facebook live Meta permissions | External approval — not a code defect |
| INR prices unapproved until flag | Intentional |
| Legal pages are scaffolds | Intentional |
| Parent workspace Git noise (sibling deletes) | Use standalone `git init` in this folder for GitHub |
| In-process scheduler (no separate worker) | Documented; intentional for current design |

## 10–13. Structure changes

**Renamed/moved**

- `code/api/authtest.mjs` → `tests/auth.test.mjs`
- `admintest.mjs` → `tests/admin.test.mjs`
- `billtest.mjs` → `tests/billing.test.mjs`
- `socialtest.mjs` → `tests/social.test.mjs`
- `batch1test.mjs` → `tests/durability.test.mjs`
- `batch2test.mjs` → `tests/policy.test.mjs`
- `batch3test.mjs` → `tests/contacts.test.mjs`

**Created**

- `tests/unit.test.mjs`, `code/web/tests/product.test.mjs`
- Restored `DEPLOY.md`, `CONTRIBUTING.md`, `scripts/*`, `staging/*`, `docs/REL-26-shared-shell-plan.md`
- `QUALITY_AUDIT_REPORT.md`

**Deleted this pass:** none beyond prior cleanup (progress checklists already removed)

## 14. ENV audit

Production required (startup gate): `AUTH_SECRET`, `ENC_KEY`, `MONGODB_URI`, `PUBLIC_URL`, `CORS_ORIGIN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `RESEND_API_KEY`, `MAIL_FROM`; refuses `RELAY_ALLOW_MEMORY=1`.

Legacy: `PULSE_ADMIN_KEY`, `PULSE_RATE`, `/api/pulse` mounts.

Full inventory: `ENVIRONMENT.md`. Examples: `code/api/.env.example`, `code/web/.env.example`, `staging/.env.staging.example`.

## 15. Security audit

`npm audit` API **PASS** 0 / web **PASS** 0. HMAC + timing-safe compare covered by unit + durability tests. No secrets committed (`.env` gitignored).

## 16–20. Build / platform readiness

| Item | Status |
| --- | --- |
| Frontend production build | **PASS** |
| API automated tests | **PASS** |
| Vercel config (`code/web`, `vercel.json`, `API_URL`) | **PASS** (config present; deploy **NOT TESTED**) |
| Render config (`code/api`, `render.yaml`, `/health`) | **PASS** (config present; deploy **NOT TESTED**) |
| GitHub readiness | **PASS** structure/gitignore; push **NOT** executed |

## 21–22. Externals / Docker

Credentials still required: Atlas, Meta, Stripe, Resend, optional Razorpay/Sentry. Docker Desktop absent → image builds **NOT TESTED**.

## 23. Recommended next step

1. `git init` inside `twwios-relay` (standalone), verify `git status` has no `.env`.  
2. Push **private** GitHub repo when authorized.  
3. Configure Render + Vercel + Atlas from `ENVIRONMENT.md`.  
4. Wire Meta/Stripe/Resend webhooks; run live staging E2E separately.
