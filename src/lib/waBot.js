import { createBotEngine } from "./botEngine.js";
import { sendWhatsAppText, sendWhatsAppButtons } from "./whatsapp.js";

/**
 * WhatsApp order bot. All conversation logic lives in botEngine.js and is
 * shared with Instagram and Messenger; this file only describes WhatsApp.
 *
 * Owner alerts use a free-form message, which WhatsApp only delivers if the
 * owner messaged the business number in the last 24 hours (error 131047
 * otherwise). The order is saved and visible on /admin either way.
 */
const engine = createBotEngine({
  channel: "whatsapp",
  label: "WhatsApp",
  tables: { settings: "wa_settings", conversations: "wa_conversations", messages: "wa_messages", keywords: "wa_keywords" },
  userColumn: "phone_number",
  ownerColumn: "owner_whatsapp_number",
  textLimit: 3800, // API cap is 4096
  welcomeEndsTurn: false,
  sendText: sendWhatsAppText,
  sendButtons: sendWhatsAppButtons,
  onFollowupError: (to, err) => {
    // 131047 = outside the 24h customer-service window; nothing to do about it.
    const code = err.whatsappError?.code;
    console.error(`WhatsApp follow-up to ${to} failed${code ? ` (code ${code})` : ""}:`, err.message);
  },
});

export const handleIncomingMessage = ({ phoneNumber, profileName, text, buttonId, waMessageId }) =>
  engine.handleIncoming({ userId: phoneNumber, profileName, text, buttonId, messageId: waMessageId });

export const sendPendingFollowups = () => engine.sendPendingFollowups();
