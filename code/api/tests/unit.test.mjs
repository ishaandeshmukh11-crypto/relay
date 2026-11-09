// Pure unit checks: crypto helpers, phone normalization, checkout gates (no server).
import assert from "node:assert/strict";
import { metaSignatureOk } from "../relay/inbox.js";
import { normalizePhone } from "../relay/shield.js";
import { checkoutAllowed, USD_PRICES } from "../relay/billing.js";
import { timingSafeEqualStr } from "../relay/auth.js";
import crypto from "node:crypto";

assert.equal(timingSafeEqualStr("abc", "abc"), true);
assert.equal(timingSafeEqualStr("abc", "abd"), false);

const secret = "unit-secret-unit-secret-unit";
const body = Buffer.from(JSON.stringify({ entry: [] }));
const good = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

assert.equal(metaSignatureOk(body, good, secret), true, "valid HMAC accepted");
assert.equal(metaSignatureOk(body, "sha256=deadbeef", secret), false, "bad HMAC rejected");
assert.equal(metaSignatureOk(body, good, ""), false, "empty secret rejected");
assert.equal(metaSignatureOk(null, good, secret), false, "null body rejected");

assert.equal(normalizePhone("+14155552671"), "14155552671");
assert.equal(normalizePhone("4155552671", "US"), "14155552671");
assert.equal(normalizePhone("4155552671"), null);

assert.equal(USD_PRICES.starter.amount, 49);
assert.equal(USD_PRICES.growth.amount, 149);
const blocked = checkoutAllowed("starter", { currency: "INR" });
assert.equal(blocked.ok, false);

console.log("PASS unit: HMAC, phone normalize, USD prices, INR gate");
