import { createHmac, timingSafeEqual } from "crypto";
import "dotenv/config";
import { getIgConnection } from "./igConnection.js";

async function callGraph(body) {
  const { pageId, igUserId, accessToken } = await getIgConnection();
  if ((!pageId && !igUserId) || !accessToken) {
    throw new Error("Instagram isn't connected yet - set it up in the admin Instagram DM page.");
  }

  const endpoint = pageId
    ? `https://graph.facebook.com/${process.env.INSTAGRAM_API_VERSION || process.env.WHATSAPP_API_VERSION || "v21.0"}/${igUserId}/messages`
    : `https://graph.instagram.com/${process.env.INSTAGRAM_API_VERSION || process.env.WHATSAPP_API_VERSION || "v21.0"}/${igUserId}/messages`;
  const res = await fetch(endpoint, {
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
    // Record exactly which host/igUserId this attempt used, so a failure
    // (e.g. "user cannot be found") can be checked against what was
    // connected at send time - useful when the connection was changed
    // (reconnect/resubscribe) around the same time as the failure, since
    // getIgConnection() caches for 30s and a send can land mid-swap.
    err.requestContext = { endpoint, igUserId, hadPageId: Boolean(pageId) };
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
 *
 * NOTE: kept for reference/tests, but igBot.js uses sendInstagramButtons
 * instead - quick_replies are ephemeral (Instagram only ever shows them
 * attached to the single most recent message in the thread, so they vanish
 * the moment any other message is sent), which made our buttons flicker
 * away right after the greeting. The button template below doesn't have
 * that problem since the buttons are part of the message content itself.
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
 * Button template - up to 3 persistent postback buttons attached to a
 * message. Unlike quick replies, these stay visible in the thread history
 * (they're part of the message bubble, not a latest-message-only UI
 * overlay), so they won't disappear the instant a follow-up message is
 * sent. Tapping one fires a `messaging_postbacks` webhook event with the
 * button's payload - see routes/instagramWebhook.js.
 * @param {Array<{id: string, title: string}>} buttons
 */
export function sendInstagramButtons(senderId, bodyText, buttons) {
  return callGraph({
    recipient: { id: senderId },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: bodyText.slice(0, 640),
          buttons: buttons.slice(0, 3).map((b) => ({
            type: "postback",
            title: b.title.slice(0, 20),
            payload: b.id,
          })),
        },
      },
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
  if (!Buffer.isBuffer(rawBody)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
