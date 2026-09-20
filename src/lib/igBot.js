import { createBotEngine } from "./botEngine.js";
import { sendInstagramText, sendInstagramButtons } from "./instagram.js";

/** Instagram DM order bot - see botEngine.js for the shared logic. */
const engine = createBotEngine({
  channel: "instagram",
  label: "Instagram",
  tables: { settings: "ig_settings", conversations: "ig_conversations", messages: "ig_messages", keywords: "ig_keywords" },
  userColumn: "sender_id",
  ownerColumn: "owner_ig_sender_id",
  textLimit: 950, // Instagram rejects text over ~1000 characters
  welcomeEndsTurn: true,
  sendText: sendInstagramText,
  sendButtons: sendInstagramButtons,
});

export const handleIncomingMessage = ({ senderId, profileName, text, buttonId, igMessageId }) =>
  engine.handleIncoming({ userId: senderId, profileName, text, buttonId, messageId: igMessageId });

export const sendPendingIgFollowups = () => engine.sendPendingFollowups();
