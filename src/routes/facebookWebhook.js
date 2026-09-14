import { Router } from "express";
import { verifyFacebookSignature } from "../lib/facebook.js";
import { getFbConnection } from "../lib/fbConnection.js";
import { handleIncomingMessage } from "../lib/fbBot.js";
import { logWebhookEvent } from "../lib/webhookLog.js";
import { parseMetaWebhookBody } from "../middleware/metaWebhookBody.js";

const router = Router();

router.get("/", async (req, res) => {
  const { verifyToken } = await getFbConnection();
  if (req.query["hub.mode"] === "subscribe" && verifyToken && req.query["hub.verify_token"] === verifyToken) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

router.post("/", async (req, res) => {
  const payload = parseMetaWebhookBody(req);
  res.sendStatus(200);
  let signatureValid = null;
  let messageCount = 0;
  let errorMessage = null;
  try {
    const signatureCheck = await verifyFacebookSignature(req.rawBody, req.headers["x-hub-signature-256"]);
    signatureValid = Boolean(signatureCheck);
    if (!signatureCheck) return;
    if (signatureCheck === true && !(await getFbConnection()).appSecret) signatureValid = null;
    if (!payload) throw new Error("Invalid JSON webhook payload.");
    for (const entry of payload.entry || []) {
      for (const event of entry.messaging || []) {
        if (!event.message && !event.postback) continue;
        if (event.message?.is_echo) continue;
        const senderId = event.sender?.id;
        if (!senderId) continue;
        const postback = event.postback;
        const message = event.message;
        const text = postback ? "" : (typeof message?.text === "string" ? message.text : "");
        const buttonId = postback?.payload || message?.quick_reply?.payload || null;
        if (!postback && !text && !buttonId) continue;
        messageCount++;
        await handleIncomingMessage({ senderId, profileName: null, text, buttonId, fbMessageId: message?.mid || postback?.mid || null });
      }
    }
  } catch (err) {
    errorMessage = err.message;
    console.error("[Facebook Webhook] Processing error:", err);
  } finally {
    await logWebhookEvent({ platform: "facebook", payload, signatureValid, messageCount, errorMessage });
  }
});

export default router;
