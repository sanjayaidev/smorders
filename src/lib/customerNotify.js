import { sendWhatsAppText } from "./whatsapp.js";
import { sendInstagramText } from "./instagram.js";
import { sendFacebookText } from "./facebook.js";
import { t, normalizeLanguage } from "./botI18n.js";

const SENDERS = {
  whatsapp: sendWhatsAppText,
  instagram: sendInstagramText,
  facebook: sendFacebookText,
};

/** Which message (if any) each new status triggers. on_queue is silent. */
const STATUS_MESSAGES = {
  preparing: "notifPreparing",
  delivered: "notifDelivered",
  cancelled: "notifCancelled",
};

export function notificationsEnabled() {
  return String(process.env.CUSTOMER_STATUS_NOTIFICATIONS || "on").toLowerCase() !== "off";
}

/** The message a customer should get for this order's new status, or null. */
export function statusChangeMessage(order) {
  const key = STATUS_MESSAGES[order.status];
  if (!key) return null;
  return t(normalizeLanguage(order.lang), key, {
    code: order.order_code,
    reason: order.cancellation_reason || "-",
  });
}

/**
 * Best-effort message to the customer who placed `order` through a chat
 * channel, telling them the kitchen moved it along. Website orders have no
 * chat to reply to, so they (and orders placed before `customer_ref` existed)
 * are skipped. Never throws - the admin's status change has already been
 * saved and must not fail because a customer's chat window closed (Meta only
 * allows free-form replies within 24 hours of the customer's last message).
 *
 * Set CUSTOMER_STATUS_NOTIFICATIONS=off to disable.
 *
 * @returns {Promise<boolean>} true if a message was sent
 */
export async function notifyCustomerOfStatusChange(order, senders = SENDERS) {
  try {
    if (!notificationsEnabled()) return false;
    const send = senders[order.channel];
    if (!send || !order.customer_ref) return false;
    const text = statusChangeMessage(order);
    if (!text) return false;
    await send(order.customer_ref, text);
    return true;
  } catch (error) {
    console.error(`Status notification for order ${order?.order_code} failed:`, error.message);
    return false;
  }
}
