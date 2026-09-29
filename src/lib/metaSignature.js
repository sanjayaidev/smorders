import { createHmac, timingSafeEqual } from "crypto";

/**
 * Shared X-Hub-Signature-256 check for the WhatsApp / Instagram / Facebook
 * webhooks.
 *
 * FAILS CLOSED: if no App Secret is configured, the webhook is rejected.
 * (A hardcoded "default" secret would be worthless - anyone can read it in
 * the repo and sign forged payloads with it. And Meta signs with YOUR real
 * secret, so a default could never match genuine traffic anyway.)
 *
 * Temporary escape hatch for the moment you deploy this before the secrets
 * are set: ALLOW_UNSIGNED_WEBHOOKS=true restores the old behaviour. Remove it
 * once the App Secrets are configured.
 */
export function verifyMetaSignature({ platform, appSecret, rawBody, signatureHeader }) {
  if (!appSecret) {
    if (process.env.ALLOW_UNSIGNED_WEBHOOKS === "true") {
      console.warn(`${platform} App Secret not set - ALLOW_UNSIGNED_WEBHOOKS=true, accepting UNSIGNED webhook.`);
      return true;
    }
    console.error(`${platform} App Secret not set - rejecting webhook. Set the App Secret (or ALLOW_UNSIGNED_WEBHOOKS=true temporarily).`);
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  if (!Buffer.isBuffer(rawBody)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
