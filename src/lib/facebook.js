import { createHmac, timingSafeEqual } from "crypto";
import "dotenv/config";
import { getFbConnection } from "./fbConnection.js";

const API_VERSION = process.env.FACEBOOK_API_VERSION || process.env.WHATSAPP_API_VERSION || "v21.0";

async function callGraph(body) {
  const { pageId, accessToken } = await getFbConnection();
  if (!pageId || !accessToken) throw new Error("Facebook Messenger isn't connected yet - set it up in the admin Messenger page.");
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${pageId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(payload?.error?.message || `Facebook send failed (${res.status})`);
    error.facebookError = payload?.error;
    throw error;
  }
  return payload;
}

export function sendFacebookText(senderId, text) {
  return callGraph({ recipient: { id: senderId }, message: { text: String(text ?? "").slice(0, 2000) } });
}

export function sendFacebookButtons(senderId, bodyText, buttons) {
  return callGraph({
    recipient: { id: senderId },
    message: { attachment: { type: "template", payload: {
      template_type: "button", text: String(bodyText).slice(0, 640),
      buttons: buttons.slice(0, 3).map((button) => ({ type: "postback", title: button.title.slice(0, 20), payload: button.id })),
    } } },
  });
}

export async function verifyFacebookSignature(rawBody, signatureHeader) {
  const { appSecret } = await getFbConnection();
  if (!appSecret) { console.warn("Facebook App Secret not set - skipping webhook signature verification."); return true; }
  if (!signatureHeader?.startsWith("sha256=") || !Buffer.isBuffer(rawBody)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
