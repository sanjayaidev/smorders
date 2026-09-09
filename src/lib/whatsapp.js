import { createHmac, timingSafeEqual } from "crypto";
import "dotenv/config";
import { getWaConnection } from "./waConnection.js";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

async function graphUrl(path) {
  const { phoneNumberId } = await getWaConnection();
  if (!phoneNumberId) {
    throw new Error("WhatsApp isn't connected yet - set it up in the admin WhatsApp Bot page.");
  }
  return `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/${path}`;
}

async function callGraph(body) {
  const { accessToken } = await getWaConnection();
  if (!accessToken) {
    throw new Error("WhatsApp isn't connected yet - set it up in the admin WhatsApp Bot page.");
  }

  const res = await fetch(await graphUrl("messages"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    // Common real-world failure here: error code 131047, which means the
    // recipient hasn't messaged this number in the last 24h ("outside the
    // customer service window") and this isn't a pre-approved template. See
    // the note in waBot.js about the owner notification for why that matters.
    const message = payload?.error?.message || `WhatsApp send failed (${res.status})`;
    const err = new Error(message);
    err.whatsappError = payload?.error;
    throw err;
  }
  return payload;
}

/** Plain text message - the workhorse for almost every bot reply. */
export function sendWhatsAppText(to, body) {
  return callGraph({ to, type: "text", text: { body } });
}

/**
 * Up to 3 quick-reply buttons under a text body. WhatsApp hard-caps this at
 * 3 buttons and 20 characters per title, so callers should keep it short.
 * @param {Array<{id: string, title: string}>} buttons
 */
export function sendWhatsAppButtons(to, bodyText, buttons) {
  return callGraph({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

/** Marks an inbound message as read (blue ticks) - purely cosmetic. */
export function markWhatsAppMessageRead(messageId) {
  return callGraph({ status: "read", message_id: messageId }).catch((err) => {
    console.error("markWhatsAppMessageRead failed:", err.message);
  });
}

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body,
 * using the Meta App Secret. Skips verification (with a console warning) if
 * no App Secret is configured (DB connection panel or WHATSAPP_APP_SECRET),
 * so setups mid-onboarding aren't blocked - but this should be set once
 * you're live.
 */
export async function verifyWhatsAppSignature(rawBody, signatureHeader) {
  const { appSecret } = await getWaConnection();
  if (!appSecret) {
    console.warn("WhatsApp App Secret not set - skipping webhook signature verification.");
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
