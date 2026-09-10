import { Router } from "express";
import { verifyWhatsAppSignature } from "../lib/whatsapp.js";
import { getWaConnection } from "../lib/waConnection.js";
import { handleIncomingMessage } from "../lib/waBot.js";

const router = Router();

/**
 * GET /api/whatsapp/webhook
 * Meta's one-time handshake when you save the webhook URL in the App
 * dashboard: it must echo back hub.challenge if hub.verify_token matches
 * the token shown in the admin's Connection panel.
 */
router.get("/", async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const { verifyToken } = await getWaConnection();
  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * POST /api/whatsapp/webhook
 * Delivers every inbound message, status update, etc. We only care about
 * inbound text/interactive-reply messages here; everything else (delivery
 * receipts, etc.) is acknowledged and ignored.
 *
 * IMPORTANT: this must always respond 200 quickly, or Meta will retry
 * (and keep retrying) the same payload - errors are caught and logged
 * rather than surfaced as a failed response.
 */
router.post("/", async (req, res) => {
  // Log webhook reception for testing/debugging
  console.log("[WhatsApp Webhook] Received webhook at:", new Date().toISOString());
  console.log("[WhatsApp Webhook] Raw body:", JSON.stringify(req.body, null, 2));
  console.log("[WhatsApp Webhook] Headers:", JSON.stringify({
    'x-hub-signature-256': req.headers['x-hub-signature-256'] ? '[present]' : '[missing]',
    'content-type': req.headers['content-type']
  }, null, 2));

  res.sendStatus(200); // ack immediately; process after responding

  try {
    const signatureCheck = await verifyWhatsAppSignature(req.rawBody, req.headers["x-hub-signature-256"]);
    if (!signatureCheck) {
      console.error("[WhatsApp Webhook] Signature verification failed, dropping payload.");
      return;
    }
    if (signatureCheck === true && !(await getWaConnection()).appSecret) {
      console.log("[WhatsApp Webhook] App Secret not configured - skipping signature verification (warning: insecure for production)");
    }

    console.log("[WhatsApp Webhook] Signature verified successfully");

    const entries = req.body?.entry || [];
    console.log(`[WhatsApp Webhook] Processing ${entries.length} entry/entries`);

    if (entries.length === 0) {
      console.log("[WhatsApp Webhook] No entries found in webhook payload - this may be a test webhook or status-only update");
    }

    for (const entry of entries) {
      console.log("[WhatsApp Webhook] Entry ID:", entry.id, "Changes:", entry.changes?.length || 0);
      for (const change of entry.changes || []) {
        const value = change.value || {};
        console.log("[WhatsApp Webhook] Change field:", change.field, "Metadata:", value.metadata?.phone_number_display || value.contacts?.[0]?.profile?.name || "N/A");
        for (const message of value.messages || []) {
          const phoneNumber = message.from; // digits only, e.g. "77001234567"
          const profileName = value.contacts?.[0]?.profile?.name;
          const waMessageId = message.id;

          let text = "";
          let buttonId = null;
          if (message.type === "text") {
            text = message.text?.body || "";
          } else if (message.type === "interactive") {
            buttonId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || null;
            text = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
          } else if (message.type === "button") {
            // Reply to a template's quick-reply button, if ever used.
            buttonId = message.button?.payload || null;
            text = message.button?.text || "";
          } else {
            console.log("[WhatsApp Webhook] Skipping non-text message type:", message.type, JSON.stringify(message));
            continue; // images, audio, location, etc. - not handled yet
          }

          console.log(`[WhatsApp Webhook] Processing message from phoneNumber=${phoneNumber}, profileName=${profileName}, text="${text}", buttonId=${buttonId}`);
          await handleIncomingMessage({ phoneNumber, profileName, text, buttonId, waMessageId });
        }
        
        // Log status updates separately
        if (value.statuses && value.statuses.length > 0) {
          console.log("[WhatsApp Webhook] Status update received:", JSON.stringify(value.statuses));
        }
      }
    }
    console.log("[WhatsApp Webhook] Successfully processed all entries");
  } catch (err) {
    console.error("[WhatsApp Webhook] Processing error:", err);
  }
});

export default router;
