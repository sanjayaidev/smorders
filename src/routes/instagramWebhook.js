import { Router } from "express";
import { verifyInstagramSignature } from "../lib/instagram.js";
import { getIgConnection } from "../lib/igConnection.js";
import { handleIncomingMessage } from "../lib/igBot.js";
import { logWebhookEvent } from "../lib/webhookLog.js";
import { parseMetaWebhookBody } from "../middleware/metaWebhookBody.js";

const router = Router();

function messagingEvents(entry) {
  const events = Array.isArray(entry.messaging) ? [...entry.messaging] : [];
  for (const change of entry.changes || []) {
    const value = change.value || {};
    // Instagram's test callback and some Graph API versions wrap a DM in
    // changes[].value instead of entry[].messaging[]. Normalize both forms.
    if (value.message && (value.sender || value.recipient)) {
      events.push({
        sender: value.sender,
        recipient: value.recipient,
        timestamp: value.timestamp,
        message: value.message,
      });
    }
  }
  return events;
}

/**
 * GET /api/instagram/webhook
 * Meta's one-time handshake when you save the webhook URL in the App
 * dashboard: it must echo back hub.challenge if hub.verify_token matches
 * INSTAGRAM_VERIFY_TOKEN (env-only - see lib/igConnection.js).
 */
router.get("/", async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const { verifyToken } = await getIgConnection();
  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * POST /api/instagram/webhook
 * Delivers every inbound DM (and echoes of our own sends, read receipts,
 * etc.) for the "instagram" webhook object. We only care about inbound text
 * / quick-reply messages here.
 *
 * IMPORTANT: this must always respond 200 quickly, or Meta will retry (and
 * keep retrying) the same payload - errors are caught and logged rather than
 * surfaced as a failed response.
 */
router.post("/", async (req, res) => {
  const payload = parseMetaWebhookBody(req);
  // Log webhook reception for testing/debugging
  console.log("[Instagram Webhook] Received webhook at:", new Date().toISOString());
  console.log("[Instagram Webhook] Raw body:", JSON.stringify(payload, null, 2));
  console.log("[Instagram Webhook] Headers:", JSON.stringify({
    'x-hub-signature-256': req.headers['x-hub-signature-256'] ? '[present]' : '[missing]',
    'content-type': req.headers['content-type']
  }, null, 2));

  res.sendStatus(200); // ack immediately; process after responding

  let signatureValid = null;
  let messageCount = 0;
  let errorMessage = null;

  try {
    const signatureCheck = await verifyInstagramSignature(req.rawBody, req.headers["x-hub-signature-256"]);
    signatureValid = Boolean(signatureCheck);
    if (!signatureCheck) {
      console.error("[Instagram Webhook] Signature verification failed, dropping payload.");
      return;
    }
    if (signatureCheck === true && !(await getIgConnection()).appSecret) {
      console.log("[Instagram Webhook] App Secret not configured - skipping signature verification (warning: insecure for production)");
      signatureValid = null; // wasn't actually checked, don't record it as "valid"
    }

    console.log("[Instagram Webhook] Signature verified successfully");

    if (!payload) throw new Error("Invalid JSON webhook payload.");
    const entries = payload.entry || [];
    console.log(`[Instagram Webhook] Processing ${entries.length} entry/entries`);

    if (entries.length === 0) {
      console.log("[Instagram Webhook] No entries found in webhook payload - this may be a test webhook or status-only update");
    }

    for (const entry of entries) {
      const events = messagingEvents(entry);
      console.log("[Instagram Webhook] Entry ID:", entry.id, "Messaging events:", events.length);
      for (const event of events) {
        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        console.log("[Instagram Webhook] Event from sender:", senderId, "to recipient:", recipientId, "Message:", event.message ? "present" : "absent");
        
        // Ignore delivery/read receipts and echoes of messages we sent ourselves.
        if (!event.message || event.message.is_echo) {
          console.log("[Instagram Webhook] Skipping non-message or echo event:", JSON.stringify(event));
          continue;
        }

        const igMessageId = event.message.mid;
        let text = "";
        let buttonId = null;
        if (event.message.quick_reply?.payload) {
          buttonId = event.message.quick_reply.payload;
          text = event.message.text || "";
        } else if (typeof event.message.text === "string") {
          text = event.message.text;
        } else {
          console.log("[Instagram Webhook] Skipping non-text message:", JSON.stringify(event.message));
          continue; // attachments (images, stickers, etc.) - not handled yet
        }

        console.log(`[Instagram Webhook] Processing message from senderId=${senderId}, text="${text}", buttonId=${buttonId}`);
        messageCount++;
        await handleIncomingMessage({ senderId, profileName: null, text, buttonId, igMessageId });
      }
    }
    console.log("[Instagram Webhook] Successfully processed all entries");
  } catch (err) {
    errorMessage = err.message;
    console.error("[Instagram Webhook] Processing error:", err);
  } finally {
    // Log every hit - real message, test payload, or failed signature check -
    // so the admin "Webhook Log" page always has something to show.
    await logWebhookEvent({ platform: "instagram", payload, signatureValid, messageCount, errorMessage });
  }
});

export default router;
