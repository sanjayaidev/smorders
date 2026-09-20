import { createBotEngine } from "./botEngine.js";
import { sendFacebookText, sendFacebookButtons } from "./facebook.js";

/** Facebook Messenger order bot - see botEngine.js for the shared logic. */
const engine = createBotEngine({
  channel: "facebook",
  label: "Facebook",
  tables: { settings: "fb_settings", conversations: "fb_conversations", messages: "fb_messages", keywords: "fb_keywords" },
  userColumn: "sender_id",
  ownerColumn: "owner_fb_sender_id",
  textLimit: 1900, // Messenger caps text at 2000 characters
  welcomeEndsTurn: true,
  sendText: sendFacebookText,
  sendButtons: sendFacebookButtons,
});

export const handleIncomingMessage = ({ senderId, profileName, text, buttonId, fbMessageId }) =>
  engine.handleIncoming({ userId: senderId, profileName, text, buttonId, messageId: fbMessageId });

export const sendPendingFbFollowups = () => engine.sendPendingFollowups();
