import { supabase as defaultDb } from "../supabaseClient.js";
import { generateOrderCode } from "./orderCode.js";
import {
  getActiveMenu,
  matchItemsWithAI,
  aiFallbackReply,
  applyCartChanges,
  formatCart,
  cartTotal,
} from "./orderMatch.js";
import { detectMessageLanguage, localizeMessage } from "./messageLanguage.js";
import { t, pickName, normalizeLanguage } from "./botI18n.js";
import { BUTTON_INTENTS, detectIntent, detectTopic, mentionsMenu, extractOrderCode } from "./botIntents.js";
import { getMenuForDisplay, formatMenuChunks, splitMessage } from "./menuFormat.js";
import {
  findRecentOrdersForCustomer,
  findOrderByCode,
  attachOrderItems,
  formatOrderStatus,
  isMissingColumnError,
} from "./orderStatus.js";

/**
 * One conversation engine shared by the WhatsApp, Instagram and Messenger
 * bots. The three used to be near-identical copies of the same ~400 lines,
 * which is how a fix in one channel kept missing the others. Each channel now
 * only supplies a small config (table names, send functions, message-size
 * limit) - see waBot.js, igBot.js and fbBot.js.
 *
 * Flow per inbound message:
 *   dedupe -> load conversation -> (expire stale draft) -> pick language ->
 *   once-a-day welcome -> built-in commands (menu, status, cart, cancel, ...) ->
 *   admin keyword replies -> the Name -> Table -> Items -> Confirm order chain.
 */

const FLOW_STAGES = ["ask_name", "ask_table", "ask_items", "confirm"];
const RESET_FIELDS = { stage: "idle", customer_name: null, table_no: null, cart: [] };
const MAX_NAME_LENGTH = 40;
const MAX_TABLE_LENGTH = 20;
const PLACING_STUCK_MS = 60 * 1000;

const BUTTON_ORDER = "order";
const BUTTON_LOCATION = "location";
const BUTTON_MENU = "menu";
const BUTTON_CONFIRM = "confirm_order";
const BUTTON_MODIFY = "modify_order";
const BUTTON_CANCEL = "cancel";

/**
 * @param {object} config
 * @param {string} config.channel        value stored in orders.channel ("whatsapp" | "instagram" | "facebook")
 * @param {string} config.label          human name used in log lines
 * @param {{settings: string, conversations: string, messages: string, keywords: string}} config.tables
 * @param {string} config.userColumn     conversation column holding the customer's id ("phone_number" | "sender_id")
 * @param {string} config.ownerColumn    settings column holding the owner's id for new-order alerts
 * @param {number} config.textLimit      max characters per text message on this channel
 * @param {boolean} config.welcomeEndsTurn  stop after the welcome (Instagram/Messenger hide buttons once another message follows)
 * @param {(to: string, text: string) => Promise<any>} config.sendText
 * @param {(to: string, body: string, buttons: Array<{id: string, title: string}>) => Promise<any>} config.sendButtons
 * @param {(to: string, err: Error) => void} [config.onFollowupError]
 * @param {object} [deps]  injectable for tests: { db, ai: { matchItems, fallbackReply, localize }, now }
 */
export function createBotEngine(config, deps = {}) {
  const { channel, label, tables, userColumn, ownerColumn, textLimit, welcomeEndsTurn, sendText, sendButtons } = config;
  const db = deps.db || defaultDb;
  const now = deps.now || (() => new Date());
  const ai = {
    matchItems: deps.ai?.matchItems || ((text, products, language, cart) => matchItemsWithAI(text, products, language, cart)),
    fallbackReply: deps.ai?.fallbackReply || ((text, products, language) => aiFallbackReply(text, products, language, { db })),
    localize: deps.ai?.localize || localizeMessage,
  };
  const draftTtlMs = (Number(process.env.BOT_DRAFT_TTL_HOURS) || 6) * 60 * 60 * 1000;

  const today = () => now().toISOString().slice(0, 10);
  const isOlderThan = (iso, ms) => Boolean(iso) && now().getTime() - new Date(iso).getTime() > ms;
  const cartOf = (conversation) => (Array.isArray(conversation.cart) ? conversation.cart : []);

  // ---------------------------------------------------------------- database

  async function getSettings() {
    const { data, error } = await db.from(tables.settings).select("*").eq("id", 1).single();
    if (error) throw error;
    return data;
  }

  async function getOrCreateConversation(userId, profileName) {
    const { data: existing, error } = await db.from(tables.conversations).select("*").eq(userColumn, userId).maybeSingle();
    if (error) throw error;
    if (existing) return existing;

    const { data: created, error: insertError } = await db
      .from(tables.conversations)
      .insert({ [userColumn]: userId, profile_name: profileName || null })
      .select()
      .single();
    if (insertError) throw insertError;
    return created;
  }

  async function updateConversation(id, patch) {
    const { data, error } = await db
      .from(tables.conversations)
      .update({ ...patch, last_message_at: now().toISOString(), followup_sent: false })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function logMessage(conversationId, direction, body, messageId) {
    // messageId is only present (and used as the PK) for inbound messages,
    // which is what lets us dedupe webhook retries. Outbound log rows get a
    // random id.
    const id = messageId || `out_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const { error } = await db.from(tables.messages).insert({ id, conversation_id: conversationId, direction, body });
    // Ignore unique-violation (23505) - it just means we've already logged
    // (and therefore already processed) this exact inbound message id.
    if (error && error.code !== "23505") console.error(`${tables.messages} insert failed:`, error.message);
    return !error || error.code !== "23505";
  }

  async function findKeywordMatch(text) {
    const normalized = String(text || "").trim().toLowerCase();
    if (!normalized) return null;

    const { data: keywords, error } = await db
      .from(tables.keywords)
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;

    return (
      (keywords || []).find((k) => {
        const kw = k.keyword.trim().toLowerCase();
        return k.match_type === "exact" ? normalized === kw : normalized.includes(kw);
      }) || null
    );
  }

  // ---------------------------------------------------------------- one message

  async function handleIncoming({ userId, profileName = null, text = "", buttonId = null, messageId = null }) {
    if (messageId) {
      const isNew = await logMessage(null, "inbound", text, messageId);
      if (!isNew) return; // already processed this exact message (webhook retry)
    }

    const settings = await getSettings();
    let convo = await getOrCreateConversation(userId, profileName);

    // A half-finished order the customer walked away from must not swallow
    // whatever they say tomorrow ("2 simit" -> a mystery cart).
    const previousActivity = convo.last_message_at;
    const draftExpired = convo.stage !== "idle" && isOlderThan(previousActivity, draftTtlMs);
    const stageBefore = draftExpired ? "idle" : convo.stage;

    const textIntent = buttonId ? null : detectIntent(text, { stage: stageBefore });
    const language = pickLanguage({ text, buttonId, stage: stageBefore, previous: convo.language, hasIntent: Boolean(textIntent) });
    convo = await updateConversation(convo.id, { language, ...(draftExpired ? RESET_FIELDS : {}) });

    // Backfill the conversation_id on the inbound log row now that we have it.
    if (messageId) await db.from(tables.messages).update({ conversation_id: convo.id }).eq("id", messageId);

    // -- output helpers (close over the current language/conversation) ------

    const send = async (body) => {
      for (const chunk of splitMessage(body, textLimit)) {
        await sendText(userId, chunk);
        await logMessage(convo.id, "outbound", chunk);
      }
    };
    /** Admin-written text: translated with the AI (cached), not one of our fixed strings. */
    const sendAdmin = async (body) => send(await ai.localize(body, language));

    const sendWelcome = async () => {
      await send(await ai.localize(settings.welcome_message, language));
      await sendButtons(userId, t(language, "welcomePrompt"), [
        { id: BUTTON_ORDER, title: await ai.localize(settings.order_button_label, language) },
        { id: BUTTON_LOCATION, title: await ai.localize(settings.location_button_label, language) },
        { id: BUTTON_MENU, title: await ai.localize(settings.menu_button_label, language) },
      ]);
    };

    const sendMenu = async (footer) => {
      let categories;
      try {
        categories = await getMenuForDisplay(db);
      } catch (error) {
        console.error(`${label} menu load failed:`, error.message);
        await send(t(language, "menuEmpty"));
        return;
      }
      const chunks = formatMenuChunks(categories, language, { limit: textLimit, footer });
      if (!chunks.length) {
        await send(t(language, "menuEmpty"));
        return;
      }
      for (const chunk of chunks) await send(chunk);
    };

    const sendSummary = async (unmatchedText = "") => {
      const cart = cartOf(convo);
      let summary =
        `${t(language, "summaryHeader")}\n\n${formatCart(cart, language)}\n\n` +
        t(language, "total", { total: cartTotal(cart), currency: cart[0].currency });
      if (unmatchedText) summary += `\n\n${t(language, "unmatchedNote", { text: unmatchedText })}`;
      await send(summary);
      await sendButtons(userId, t(language, "readyToSend"), [
        { id: BUTTON_CONFIRM, title: t(language, "btnConfirm") },
        { id: BUTTON_MODIFY, title: t(language, "btnModify") },
        { id: BUTTON_CANCEL, title: t(language, "btnCancel") },
      ]);
    };

    /** Remind the customer where they are in the order chain. */
    const resumePrompt = async ({ afterMenu = false } = {}) => {
      switch (convo.stage) {
        case "ask_name":
          return send(t(language, "askName"));
        case "ask_table":
          return send(t(language, "askTableRetry"));
        case "ask_items":
          return afterMenu ? undefined : send(t(language, "askItems"));
        case "confirm":
          return cartOf(convo).length ? sendSummary() : undefined;
        default:
          return undefined;
      }
    };

    // -- welcome -------------------------------------------------------------

    const input = (buttonId || text || "").trim();
    const intent = (buttonId ? BUTTON_INTENTS[buttonId] : null) || textIntent;
    const orderCode = buttonId ? null : extractOrderCode(text);

    if (convo.last_greeted_date !== today()) {
      convo = await updateConversation(convo.id, { last_greeted_date: today() });
      // Instagram/Messenger only keep quick-reply buttons visible on the newest
      // message, so those channels end the turn after the welcome - unless the
      // customer already said something we understand, in which case answering
      // them beats a greeting they'd have to tap through.
      const hasCommand = Boolean(intent || orderCode);
      if (!(welcomeEndsTurn && hasCommand)) {
        await sendWelcome();
        if (welcomeEndsTurn) return;
      }
    }

    if (draftExpired) await send(t(language, "draftExpired"));

    // -- an order that is being written to the database right now ------------

    if (convo.stage === "placing_order") {
      const stuck = isOlderThan(previousActivity, PLACING_STUCK_MS);
      if (!stuck) {
        await send(t(language, "placingWait"));
        return;
      }
      // The server died between claiming the confirmation and finishing; let the customer start over.
      convo = await updateConversation(convo.id, RESET_FIELDS);
    }

    // -- built-in commands (any language, any stage) --------------------------

    if (orderCode) {
      await replyStatus(orderCode);
      return;
    }

    switch (intent) {
      case "cancel":
        return handleCancel();
      case "status":
        return replyStatus(null);
      case "menu":
        await sendMenu(FLOW_STAGES.slice(2).includes(convo.stage) ? "ordering" : convo.stage === "idle" ? "idle" : "none");
        return resumePrompt({ afterMenu: true });
      case "cart":
        return handleCart();
      case "clear":
        return handleClear();
      case "help":
        return send(t(language, "help"));
      case "back":
        return handleBack();
      case "order":
        if (convo.stage === "idle") {
          convo = await updateConversation(convo.id, { stage: "ask_name" });
          return send(t(language, "orderStart"));
        }
        return resumePrompt();
      default:
        break;
    }

    // -- admin keyword replies ------------------------------------------------

    if (await tryKeywordReplies()) return;

    // A stale/unknown button must never be mistaken for a typed name or item.
    if (buttonId && !["confirm", "modify"].includes(intent)) {
      if (convo.stage === "idle") return answerWithAi(text || buttonId);
      return resumePrompt();
    }

    // -- the order chain ------------------------------------------------------

    switch (convo.stage) {
      case "ask_name": {
        if (!input) return send(t(language, "askNameRetry"));
        if (input.length > MAX_NAME_LENGTH) return send(t(language, "nameTooLong"));
        convo = await updateConversation(convo.id, { customer_name: input, stage: "ask_table" });
        return send(t(language, "askTable", { name: input }));
      }

      case "ask_table": {
        if (!input) return send(t(language, "askTableRetry"));
        if (input.length > MAX_TABLE_LENGTH) return send(t(language, "tableTooLong"));
        convo = await updateConversation(convo.id, { table_no: input, stage: "ask_items" });
        // Show the menu right here: customers can't order what they can't see.
        await sendMenu("none");
        return send(t(language, "askItems"));
      }

      case "ask_items":
        return handleItems(input);

      case "confirm": {
        if (intent === "modify") {
          convo = await updateConversation(convo.id, { stage: "ask_items" });
          return send(t(language, "modifyPrompt"));
        }
        if (intent === "confirm") return placeOrder();
        // Anything else is an edit request: "add a baklava", "remove the simit", "make it 3".
        return handleItems(input);
      }

      default:
        if (["confirm", "modify"].includes(intent)) return send(t(language, "cartEmpty")); // stale button
        return answerWithAi(input);
    }

    // ----------------------------------------------------------- handlers ----

    async function handleCancel() {
      if (convo.stage === "idle") {
        await send(t(language, "nothingToCancel"));
        return;
      }
      convo = await updateConversation(convo.id, RESET_FIELDS);
      await send(t(language, "cleared"));
    }

    async function handleCart() {
      const cart = cartOf(convo);
      if (!cart.length) {
        await send(t(language, "cartEmpty"));
        return;
      }
      if (convo.stage === "confirm") {
        await sendSummary();
        return;
      }
      await send(
        `${t(language, "cartHeader")}\n\n${formatCart(cart, language)}\n\n` +
          t(language, "total", { total: cartTotal(cart), currency: cart[0].currency })
      );
    }

    async function handleClear() {
      if (["ask_items", "confirm"].includes(convo.stage)) {
        convo = await updateConversation(convo.id, { cart: [], stage: "ask_items" });
        await send(t(language, "cartCleared"));
        return;
      }
      await send(t(language, "cartEmpty"));
    }

    async function handleBack() {
      switch (convo.stage) {
        case "ask_name":
          convo = await updateConversation(convo.id, RESET_FIELDS);
          return send(t(language, "cleared"));
        case "ask_table":
          convo = await updateConversation(convo.id, { stage: "ask_name" });
          return send(t(language, "askName"));
        case "ask_items":
          convo = await updateConversation(convo.id, { stage: "ask_table" });
          return send(t(language, "askTableRetry"));
        case "confirm":
          convo = await updateConversation(convo.id, { stage: "ask_items" });
          return send(t(language, "modifyPrompt"));
        default:
          return send(t(language, "backNothing"));
      }
    }

    async function replyStatus(code) {
      try {
        let orders;
        if (code) {
          const order = await findOrderByCode(db, code);
          if (!order) return send(t(language, "statusNotFound", { code }));
          orders = [order];
        } else {
          orders = await findRecentOrdersForCustomer(db, channel, userId);
          if (!orders.length) return send(t(language, "noRecentOrder"));
        }
        const withItems = await attachOrderItems(db, orders);
        return send(withItems.map((order) => formatOrderStatus(order, language)).join("\n\n"));
      } catch (error) {
        console.error(`${label} status lookup failed:`, error.message);
        return send(t(language, "noRecentOrder"));
      }
    }

    /** Admin keyword rules, plus multilingual aliases for them. Returns true if it replied. */
    async function tryKeywordReplies() {
      const inFlow = FLOW_STAGES.includes(convo.stage);

      if (buttonId) {
        if (buttonId !== BUTTON_LOCATION) return false;
        const match = await findKeywordMatch("location");
        if (!match) return false;
        await sendAdmin(match.response);
        return true;
      }

      if (inFlow) {
        // Mid-order a substring match could swallow a name or an item, so only
        // a message that is exactly "location" / "hours" / ... counts.
        const topic = detectTopic(input, { exactOnly: true });
        const match = topic ? await findKeywordMatch(topic) : null;
        if (!match) return false;
        await sendAdmin(match.response);
        return true;
      }

      let match = await findKeywordMatch(input);
      if (!match) {
        const topic = detectTopic(input);
        if (topic) match = await findKeywordMatch(topic);
      }
      if (match) {
        await sendAdmin(match.response);
        return true;
      }
      if (mentionsMenu(input)) {
        await sendMenu("idle");
        return true;
      }
      return false;
    }

    async function handleItems(itemsText) {
      const products = await getActiveMenu(db);
      let matched;
      try {
        matched = await ai.matchItems(itemsText, products, language, cartOf(convo));
      } catch (error) {
        console.error(`matchItemsWithAI (${label}) failed:`, error.message);
        await send(t(language, "aiTrouble"));
        return;
      }

      const cart = applyCartChanges(cartOf(convo), matched.items);
      if (!cart.length) {
        if (matched.items.length) {
          // They removed everything.
          convo = await updateConversation(convo.id, { cart: [], stage: "ask_items" });
          await send(t(language, "cartEmptyAsk"));
        } else {
          await send(t(language, "itemsMatchFail"));
        }
        return;
      }

      convo = await updateConversation(convo.id, { cart, stage: "confirm" });
      await sendSummary(matched.unmatchedText);
    }

    async function answerWithAi(question) {
      const products = await getActiveMenu(db);
      await send(await ai.fallbackReply(question, products, language));
    }

    async function placeOrder() {
      const cart = cartOf(convo);
      if (cart.length === 0) {
        convo = await updateConversation(convo.id, { stage: "ask_items" });
        await send(t(language, "cartEmptyAsk"));
        return;
      }

      // Atomically claim this confirmation before creating the order.
      // Message-id dedupe (above) doesn't cover every retry path - a button
      // tap can arrive without a message id - so if Meta redelivers the same
      // "Confirm" (or two taps race), we'd otherwise insert the order twice.
      // This conditional update only succeeds for whichever delivery gets
      // there first: it flips stage confirm -> placing_order and returns the
      // row; a loser sees zero rows matched and stops without touching the
      // orders table.
      const { data: claimed, error: claimError } = await db
        .from(tables.conversations)
        .update({ stage: "placing_order", last_message_at: now().toISOString(), followup_sent: false })
        .eq("id", convo.id)
        .eq("stage", "confirm")
        .select()
        .maybeSingle();
      if (claimError) {
        console.error(`${label} confirm claim failed:`, claimError.message);
        await send(t(language, "placeError"));
        return;
      }
      if (!claimed) return; // another delivery of this same confirm is placing the order
      convo = claimed;

      const orderRow = {
        order_code: generateOrderCode(),
        channel,
        customer_name: convo.customer_name,
        table_no: convo.table_no,
        lang: language,
        total: cartTotal(cart),
        currency: cart[0].currency,
        status: "on_queue",
        customer_ref: String(userId), // lets the customer check "status" later, and be told when it changes
      };
      let { data: order, error: orderError } = await db.from("orders").insert(orderRow).select().single();
      if (orderError && isMissingColumnError(orderError)) {
        // The customer_ref migration hasn't been run yet - place the order without it.
        const { customer_ref: _unused, ...withoutRef } = orderRow;
        ({ data: order, error: orderError } = await db.from("orders").insert(withoutRef).select().single());
      }
      if (orderError) {
        console.error(`${label} order insert failed:`, orderError.message);
        // Release the claim so the customer can retry confirming.
        convo = await updateConversation(convo.id, { stage: "confirm" });
        await send(t(language, "placeError"));
        return;
      }

      const items = cart.map((line) => ({
        order_id: order.id,
        product_id: line.productId,
        product_name: pickName(line.names, language) || line.name,
        quantity: line.quantity,
        unit_price: line.price,
      }));
      const { error: itemsError } = await db.from("order_items").insert(items);
      if (itemsError) console.error(`${label} order_items insert failed:`, itemsError.message);

      convo = await updateConversation(convo.id, RESET_FIELDS);

      await send(t(language, "orderPlaced", { code: order.order_code }));
      await notifyOwner(settings, order, items);
    }
  }

  // ---------------------------------------------------------------- owner alert

  async function notifyOwner(settings, order, items) {
    const ownerId = settings[ownerColumn];
    if (!ownerId) return;
    const lines = items.map((i) => `${i.quantity}× ${i.product_name} - ${i.unit_price * i.quantity} ${order.currency}`).join("\n");
    const text =
      `🔔 New order ${order.order_code}\n` +
      `Name: ${order.customer_name}\n` +
      `Table: ${order.table_no}\n\n` +
      `${lines}\n\nTotal: ${order.total} ${order.currency}`;
    try {
      await sendText(ownerId, text);
    } catch (error) {
      // The order itself is already saved and visible on /admin either way -
      // this alert is best-effort. On WhatsApp the usual cause is the owner not
      // having messaged the business number within the last 24 hours.
      console.error(`notifyOwner (${label}) failed:`, error.message);
    }
  }

  // ---------------------------------------------------------------- follow-ups

  /**
   * Polls for conversations that have gone quiet mid-flow and sends the
   * admin-configured follow-up nudge once. Intended to be run on an interval
   * from index.js - this app is a long-running Node process (not serverless),
   * so a simple setInterval is a reasonable stand-in for a real job queue.
   */
  async function sendPendingFollowups() {
    const settings = await getSettings();
    const cutoff = new Date(now().getTime() - settings.followup_delay_minutes * 60 * 1000).toISOString();

    const { data: stale, error } = await db
      .from(tables.conversations)
      .select(`id, ${userColumn}, language`)
      .neq("stage", "idle")
      .neq("stage", "placing_order")
      .eq("followup_sent", false)
      .lt("last_message_at", cutoff);
    if (error) {
      console.error(`${label} sendPendingFollowups query failed:`, error.message);
      return;
    }

    for (const convo of stale || []) {
      const to = convo[userColumn];
      try {
        await sendText(to, await ai.localize(settings.followup_message, convo.language));
      } catch (error_) {
        if (config.onFollowupError) config.onFollowupError(to, error_);
        else console.error(`${label} follow-up to ${to} failed:`, error_.message);
      } finally {
        // Mark as sent whether or not it actually went through - this is a
        // best-effort, once-only nudge, not something we want retried every
        // minute forever (e.g. while an access token is expired).
        await db.from(tables.conversations).update({ followup_sent: true }).eq("id", convo.id);
      }
    }
  }

  return { handleIncoming, sendPendingFollowups };
}

/**
 * Which language to reply in. Free text is detected; a button tap keeps the
 * conversation's language (the webhook hands us the button's *title* as text,
 * which would otherwise flip the language whenever a label differs). A name or
 * table number ("Çağla", "A3") says nothing about language either - unless it
 * is one of the built-in commands, which do.
 */
export function pickLanguage({ text, buttonId, stage, previous, hasIntent }) {
  if (buttonId) return normalizeLanguage(previous);
  if (["ask_name", "ask_table"].includes(stage) && !hasIntent) return normalizeLanguage(previous);
  return detectMessageLanguage(text, previous);
}
