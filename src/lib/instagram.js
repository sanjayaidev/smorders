import { createHmac, timingSafeEqual } from "crypto";
import "dotenv/config";
import { getIgConnection } from "./igConnection.js";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0"; // same Graph API, same version pin as WhatsApp

async function callGraph(body) {
  const { pageId, accessToken } = await getIgConnection();
  if (!pageId || !accessToken) {
    throw new Error("Instagram isn't connected yet - set it up in the admin Instagram DM page.");
  }

  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${pageId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    // Common real-world failure: error code 10 / #551, meaning the recipient
    // hasn't messaged this Instagram account within the messaging window, so
    // Meta refuses to deliver a non-tagged message.
    const message = payload?.error?.message || `Instagram send failed (${res.status})`;
    const err = new Error(message);
    err.instagramError = payload?.error;
    throw err;
  }
  return payload;
}

/** Plain text DM - the workhorse for almost every bot reply. */
export function sendInstagramText(senderId, text) {
  return callGraph({ recipient: { id: senderId }, message: { text } });
}

/**
 * Up to 3 quick replies under a text body, mirroring the WhatsApp button
 * flow. Instagram allows up to 13 quick replies and 20 characters per
 * title; we cap at 3 to keep the same UX as WhatsApp's button messages.
 * @param {Array<{id: string, title: string}>} buttons
 */
export function sendInstagramQuickReplies(senderId, bodyText, buttons) {
  return callGraph({
    recipient: { id: senderId },
    message: {
      text: bodyText,
      quick_replies: buttons.slice(0, 3).map((b) => ({
        content_type: "text",
        title: b.title.slice(0, 20),
        payload: b.id,
      })),
    },
  });
}

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body,
 * using the Meta App Secret. Skips verification (with a console warning) if
 * no App Secret is configured, so setups mid-onboarding aren't blocked - but
 * this should be set once you're live. Identical scheme to WhatsApp's.
 */
export async function verifyInstagramSignature(rawBody, signatureHeader) {
  const { appSecret } = await getIgConnection();
  if (!appSecret) {
    console.warn("Instagram App Secret not set - skipping webhook signature verification.");
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
