import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import { verifyMetaSignature } from "../src/lib/metaSignature.js";
import { adminLoginLimiter, orderLookupFailLimiter } from "../src/middleware/rateLimits.js";

const body = Buffer.from('{"hello":"world"}');
const sign = (secret) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

test("signature: valid secret + signature passes", () => {
  assert.equal(verifyMetaSignature({ platform: "T", appSecret: "s3cret", rawBody: body, signatureHeader: sign("s3cret") }), true);
});
test("signature: wrong signature rejected", () => {
  assert.equal(verifyMetaSignature({ platform: "T", appSecret: "s3cret", rawBody: body, signatureHeader: sign("other") }), false);
});
test("signature: missing secret FAILS CLOSED", () => {
  delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
  assert.equal(verifyMetaSignature({ platform: "T", appSecret: null, rawBody: body, signatureHeader: sign("anything") }), false);
});
test("signature: missing secret + ALLOW_UNSIGNED_WEBHOOKS=true is the explicit opt-in", () => {
  process.env.ALLOW_UNSIGNED_WEBHOOKS = "true";
  assert.equal(verifyMetaSignature({ platform: "T", appSecret: null, rawBody: body, signatureHeader: null }), true);
  delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
});

async function withApp(setup, fn) {
  const app = express();
  setup(app);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test("rate limit: login blocks after 10 failures, then returns 429", async () => {
  await withApp((app) => app.post("/login", adminLoginLimiter, (req, res) => res.status(401).json({ error: "no" })), async (base) => {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await fetch(base + "/login", { method: "POST" })).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
    assert.equal(codes[10], 429);
  });
});

test("rate limit: successful order lookups are not counted, 404s are", async () => {
  await withApp((app) => app.get("/o/:c", orderLookupFailLimiter, (req, res) => res.status(req.params.c === "ok" ? 200 : 404).end()), async (base) => {
    for (let i = 0; i < 40; i++) assert.equal((await fetch(base + "/o/ok")).status, 200);
    const codes = [];
    for (let i = 0; i < 22; i++) codes.push((await fetch(base + "/o/bad")).status);
    assert.equal(codes[19], 404);
    assert.equal(codes[20], 429);
  });
});
