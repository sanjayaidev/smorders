import { supabase } from "../supabaseClient.js";
import { generateOrderCode } from "./orderCode.js";
import { sendFacebookText, sendFacebookButtons } from "./facebook.js";
import { getActiveMenu, matchItemsWithAI, aiFallbackReply, formatCart, cartTotal } from "./orderMatch.js";
import { detectMessageLanguage, localizeMessage } from "./messageLanguage.js";

const ORDER = "order";
const LOCATION = "location";
const MENU = "menu";
const CONFIRM = "confirm_order";
const MODIFY = "modify_order";
const today = () => new Date().toISOString().slice(0, 10);

async function settings() {
  const { data, error } = await supabase.from("fb_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}
async function conversation(senderId, profileName) {
  const { data, error } = await supabase.from("fb_conversations").select("*").eq("sender_id", senderId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const created = await supabase.from("fb_conversations").insert({ sender_id: senderId, profile_name: profileName || null }).select().single();
  if (created.error) throw created.error;
  return created.data;
}
async function update(id, patch) {
  const result = await supabase.from("fb_conversations").update({ ...patch, last_message_at: new Date().toISOString(), followup_sent: false }).eq("id", id).select().single();
  if (result.error) throw result.error;
  return result.data;
}
async function log(conversationId, direction, body, messageId) {
  const id = messageId || `out_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const result = await supabase.from("fb_messages").insert({ id, conversation_id: conversationId, direction, body });
  if (result.error && result.error.code !== "23505") console.error("fb_messages insert failed:", result.error.message);
  return !result.error || result.error.code !== "23505";
}
async function keyword(text) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  const { data, error } = await supabase.from("fb_keywords").select("*").eq("active", true).order("sort_order", { ascending: true });
  if (error) throw error;
  return (data || []).find((item) => item.match_type === "exact" ? normalized === item.keyword.trim().toLowerCase() : normalized.includes(item.keyword.trim().toLowerCase())) || null;
}
async function welcome(convo, config, language) {
  await sendFacebookText(convo.sender_id, await localizeMessage(config.welcome_message, language));
  await sendFacebookButtons(convo.sender_id, await localizeMessage("What would you like to do?", language), [
    { id: ORDER, title: await localizeMessage(config.order_button_label, language) },
    { id: LOCATION, title: await localizeMessage(config.location_button_label, language) },
    { id: MENU, title: await localizeMessage(config.menu_button_label, language) },
  ]);
}
async function notifyOwner(config, order, cart) {
  if (!config.owner_fb_sender_id) return;
  const lines = cart.map((item) => `${item.quantity}x ${item.name} - ${item.unit_price * item.quantity} ${order.currency}`).join("\n");
  try { await sendFacebookText(config.owner_fb_sender_id, `🔔 New order ${order.order_code}\nName: ${order.customer_name}\nTable: ${order.table_no}\n\n${lines}\n\nTotal: ${order.total} ${order.currency}`); }
  catch (error) { console.error("Facebook notifyOwner failed:", error.message); }
}

export async function handleIncomingMessage({ senderId, profileName, text, buttonId, fbMessageId }) {
  if (fbMessageId && !(await log(null, "inbound", text, fbMessageId))) return;
  const config = await settings();
  let convo = await conversation(senderId, profileName);
  const language = detectMessageLanguage(text, convo.language);
  convo = await update(convo.id, { language });
  if (fbMessageId) await supabase.from("fb_messages").update({ conversation_id: convo.id }).eq("id", fbMessageId);
  const reply = async (body) => { const localized = await localizeMessage(body, language); await sendFacebookText(senderId, localized); await log(convo.id, "outbound", localized); };

  if (convo.last_greeted_date !== today()) {
    convo = await update(convo.id, { last_greeted_date: today() });
    await welcome(convo, config, language);
    return;
  }
  const input = (buttonId || text || "").trim();
  const normalized = input.toLowerCase();
  if (["cancel", "restart", "reset"].includes(normalized)) {
    await update(convo.id, { stage: "idle", customer_name: null, table_no: null, cart: [] });
    await reply('No problem, I\'ve cleared that. Say "order" any time you\'re ready to start again 🙂');
    return;
  }
  if (buttonId === ORDER || (convo.stage === "idle" && normalized === ORDER)) {
    await update(convo.id, { stage: "ask_name" });
    await reply("Great, let's get your order started! What name should I put on it?");
    return;
  }
  if (!["ask_name", "ask_table", "ask_items", "confirm"].includes(convo.stage) || buttonId) {
    const match = await keyword(buttonId === LOCATION ? "location" : buttonId === MENU ? "menu price" : input);
    if (match) { await reply(match.response); return; }
  }
  if (convo.stage === "ask_name") { if (!input) { await reply("Sorry, what name should I put on the order?"); return; } await update(convo.id, { customer_name: input, stage: "ask_table" }); await reply(`Thanks, ${input}! What table number are you at?`); return; }
  if (convo.stage === "ask_table") { if (!input) { await reply("What table number are you at?"); return; } await update(convo.id, { table_no: input, stage: "ask_items" }); await reply('What would you like to order? You can type it naturally, e.g. "2 simit and a tea".'); return; }
  if (convo.stage === "ask_items") {
    let matched;
    try { matched = await matchItemsWithAI(input, await getActiveMenu(), language); } catch (error) { console.error("matchItemsWithAI (Facebook) failed:", error.message); await reply("Sorry, I had trouble reading that - could you list the items again?"); return; }
    const cart = Array.isArray(convo.cart) ? [...convo.cart] : [];
    for (const item of matched.items) { const existing = cart.find((entry) => entry.slug === item.slug); if (existing) existing.quantity += item.quantity; else cart.push(item); }
    if (!cart.length) { await reply("I couldn't match that to anything on the menu - could you try naming the items again?"); return; }
    convo = await update(convo.id, { cart, stage: "confirm" });
    let summary = `Here's your order so far:\n\n${formatCart(cart)}\n\nTotal: ${cartTotal(cart)} ${cart[0].currency}`;
    if (matched.unmatchedText) summary += `\n\n(I couldn't match "${matched.unmatchedText}" to anything on the menu, so I left it out.)`;
    const localizedSummary = await localizeMessage(summary, language);
    await sendFacebookText(senderId, localizedSummary); await log(convo.id, "outbound", localizedSummary);
    await sendFacebookButtons(senderId, await localizeMessage("Ready to send this to the kitchen?", language), [{ id: CONFIRM, title: await localizeMessage("Confirm", language) }, { id: MODIFY, title: await localizeMessage("Add / change", language) }]);
    return;
  }
  if (convo.stage === "confirm") {
    if (buttonId === MODIFY) { await update(convo.id, { stage: "ask_items" }); await reply("Sure - what would you like to add or change?"); return; }
    if (buttonId !== CONFIRM && normalized !== "confirm") { await reply('Tap "Confirm" to send this order, or "Add / change" to modify it.'); return; }
    const cart = Array.isArray(convo.cart) ? convo.cart : [];
    if (!cart.length) { await update(convo.id, { stage: "ask_items" }); await reply("Looks like the cart's empty - what would you like to order?"); return; }
    const claimed = await supabase.from("fb_conversations").update({ stage: "placing_order", last_message_at: new Date().toISOString(), followup_sent: false }).eq("id", convo.id).eq("stage", "confirm").select().maybeSingle();
    if (claimed.error) { console.error("Facebook confirm claim failed:", claimed.error.message); await reply("Sorry, something went wrong placing that order - please try confirming again."); return; }
    if (!claimed.data) return;
    convo = claimed.data;
    const orderResult = await supabase.from("orders").insert({ order_code: generateOrderCode(), channel: "facebook", customer_name: convo.customer_name, table_no: convo.table_no, lang: language, total: cartTotal(cart), currency: cart[0].currency, status: "on_queue" }).select().single();
    if (orderResult.error) { await update(convo.id, { stage: "confirm" }); await reply("Sorry, something went wrong placing that order - please try confirming again."); return; }
    const order = orderResult.data;
    const itemResult = await supabase.from("order_items").insert(cart.map((item) => ({ order_id: order.id, product_id: item.productId, product_name: item.name, quantity: item.quantity, unit_price: item.price })));
    if (itemResult.error) console.error("Facebook order_items insert failed:", itemResult.error.message);
    await update(convo.id, { stage: "idle", customer_name: null, table_no: null, cart: [] });
    await reply(`🎉 Order placed! Your order code is ${order.order_code}. We'll bring it to your table shortly.`);
    await notifyOwner(config, order, cart);
    return;
  }
  const answer = await aiFallbackReply(input, await getActiveMenu(), config.order_button_label, language);
  await reply(answer);
}

export async function sendPendingFbFollowups() {
  const config = await settings();
  const cutoff = new Date(Date.now() - config.followup_delay_minutes * 60 * 1000).toISOString();
  const result = await supabase.from("fb_conversations").select("id, sender_id, language").neq("stage", "idle").neq("stage", "placing_order").eq("followup_sent", false).lt("last_message_at", cutoff);
  if (result.error) { console.error("sendPendingFbFollowups query failed:", result.error.message); return; }
  for (const convo of result.data || []) { try { await sendFacebookText(convo.sender_id, await localizeMessage(config.followup_message, convo.language)); } catch (error) { console.error(`Facebook follow-up to ${convo.sender_id} failed:`, error.message); } finally { await supabase.from("fb_conversations").update({ followup_sent: true }).eq("id", convo.id); } }
}
