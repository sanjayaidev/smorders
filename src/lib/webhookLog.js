import { supabase } from "../supabaseClient.js";

/**
 * Records one inbound webhook POST (WhatsApp or Instagram) so the admin
 * "Webhook Log" page can show it, whether it was a real message, a
 * status-only update, or a test payload from Meta's dashboard.
 *
 * Intentionally fire-and-forget from the caller's point of view - a logging
 * failure here should never affect webhook processing, so this only ever
 * logs its own errors rather than throwing.
 */
export async function logWebhookEvent({ platform, payload, signatureValid, messageCount, errorMessage }) {
  try {
    const { error } = await supabase.from("webhook_events").insert({
      platform,
      payload: payload ?? {},
      signature_valid: signatureValid ?? null,
      message_count: messageCount ?? 0,
      is_test: (messageCount ?? 0) === 0,
      error_message: errorMessage ?? null,
    });
    if (error) console.error(`[webhookLog] Failed to insert ${platform} webhook event:`, error.message);
  } catch (err) {
    console.error(`[webhookLog] Unexpected error logging ${platform} webhook event:`, err.message);
  }
}
