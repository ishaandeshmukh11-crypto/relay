# REL-26 — Shared TWWIOS app shell and Mira handoff

## Current state
- This package is Relay-only (`code/api`, `code/web`).
- `relay/hooks.js` exports `hooks.inbound = null`. No Mira engine is mounted.
- Product copy does not claim Mira/team handoff as available.

## Proposed architecture (not implemented)
Shared shell with one login, entitlements, agent tiles, and inbox handoff to Mira. See developer handbook for future work.
