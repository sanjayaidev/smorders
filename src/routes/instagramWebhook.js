import { Router } from "express";
import { verifyInstagramSignature } from "../lib/instagram.js";
import { getIgConnection } from "../lib/igConnection.js";
import { handleIncomingMessage } from "../lib/igBot.js";

const router = Router();

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
  res.sendStatus(200); // ack immediately; process after responding

  try {
    if (!(await verifyInstagramSignature(req.rawBody, req.headers["x-hub-signature-256"]))) {
      console.error("Instagram webhook: signature verification failed, dropping payload.");
      return;
    }

    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        // Ignore delivery/read receipts and echoes of messages we sent ourselves.
        if (!event.message || event.message.is_echo) continue;

        const igMessageId = event.message.mid;
        let text = "";
        let buttonId = null;
        if (event.message.quick_reply?.payload) {
          buttonId = event.message.quick_reply.payload;
          text = event.message.text || "";
        } else if (typeof event.message.text === "string") {
          text = event.message.text;
        } else {
          continue; // attachments (images, stickers, etc.) - not handled yet
        }

        await handleIncomingMessage({ senderId, profileName: null, text, buttonId, igMessageId });
      }
    }
  } catch (err) {
    console.error("Instagram webhook processing error:", err);
  }
});

export default router;
