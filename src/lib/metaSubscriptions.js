const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";
const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_API_VERSION || WHATSAPP_API_VERSION;

async function subscribe(url, accessToken, label) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `${label} webhook subscription failed (${response.status}).`);
  }
  return payload;
}

/** Subscribes the WhatsApp Business Account to this app's webhooks. */
export function subscribeWhatsAppWebhook(wabaId, accessToken) {
  return subscribe(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${wabaId}/subscribed_apps`,
    accessToken,
    "WhatsApp"
  );
}

/** Subscribes either an Instagram Login user or a Page-linked account. */
export function subscribeInstagramWebhook(igUserId, accessToken, pageId = null) {
  const params = new URLSearchParams({ subscribed_fields: "messages" });
  const url = pageId
    ? `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${pageId}/subscribed_apps?${params}`
    : `https://graph.instagram.com/${INSTAGRAM_API_VERSION}/${igUserId}/subscribed_apps?${params}`;
  return subscribe(
    url,
    accessToken,
    "Instagram"
  );
}