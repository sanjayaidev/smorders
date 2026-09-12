import { supabase } from "../supabaseClient.js";
import { generateOrderCode } from "./orderCode.js";
import { sendInstagramText, sendInstagramButtons } from "./instagram.js";
import { getActiveMenu, matchItemsWithAI, aiFallbackReply, formatCart, cartTotal } from "./orderMatch.js";

const BUTTON_ORDER = "order";
const BUTTON_LOCATION = "location";
const BUTTON_MENU = "menu";
const BUTTON_CONFIRM = "confirm_order";
const BUTTON_MODIFY = "modify_order";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function getSettings() {
  const { data, error } = await supabase.from("ig_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

async function getOrCreateConversation(senderId, profileName) {
  const { data: existing, error } = await supabase
    .from("ig_conversations")
    .select("*")
    .eq("sender_id", senderId)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from("ig_conversations")
    .insert({ sender_id: senderId, profile_name: profileName || null })
    .select()
    .single();
  if (insertError) throw insertError;
  return created;
}

async function updateConversation(id, patch) {
  const { data, error } = await supabase
    .from("ig_conversations")
    .update({ ...patch, last_message_at: new Date().toISOString(), followup_sent: false })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function logMessage(conversationId, direction, body, igMessageId) {
  // igMessageId ("mid") is only present (and used as the PK) for inbound
  // messages, which is what lets us dedupe webhook retries. Outbound log
  // rows get a random id.
  const id = igMessageId || `out_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { error } = await supabase
    .from("ig_messages")
    .insert({ id, conversation_id: conversationId, direction, body });
  // Ignore unique-violation (23505) - it just means we've already logged
  // (and therefore already processed) this exact inbound message id.
  if (error && error.code !== "23505") console.error("ig_messages insert failed:", error.message);
  return !error || error.code !== "23505";
}

async function findKeywordMatch(text) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  const { data: keywords, error } = await supabase
    .from("ig_keywords")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  return (
    keywords.find((k) => {
      const kw = k.keyword.trim().toLowerCase();
      return k.match_type === "exact" ? normalized === kw : normalized.includes(kw);
    }) || null
  );
}

async function sendWelcome(conversation, settings) {
  await sendInstagramText(conversation.sender_id, settings.welcome_message);
  await sendInstagramButtons(conversation.sender_id, "What would you like to do?", [
    { id: BUTTON_ORDER, title: settings.order_button_label },
    { id: BUTTON_LOCATION, title: settings.location_button_label },
    { id: BUTTON_MENU, title: settings.menu_button_label },
  ]);
}

async function notifyOwner(settings, conversation, order) {
  if (!settings.owner_ig_sender_id) return;
  const lines = order.items
    .map((i) => `${i.quantity}× ${i.product_name} - ${i.unit_price * i.quantity} ${order.currency}`)
    .join("\n");
  const text =
    `🔔 New order ${order.order_code}\n` +
    `Name: ${order.customer_name}\n` +
    `Table: ${order.table_no}\n\n` +
    `${lines}\n\nTotal: ${order.total} ${order.currency}`;
  try {
    await sendInstagramText(settings.owner_ig_sender_id, text);
  } catch (err) {
    // Order itself is already saved and visible on /admin either way - this
    // notification is best-effort on top of that, not the source of truth.
    console.error("notifyOwner (Instagram) failed:", err.message);
  }
}

/**
 * Entry point called by the webhook route for every inbound customer DM.
 * Same shape as waBot.js's handleIncomingMessage - the once-a-day welcome,
 * admin-defined keyword automations, and the built-in Name -> Table -> Items
 * -> Confirm order chain. Never throws for "normal" flow issues - errors are
 * logged and the customer gets a graceful fallback reply instead of silence.
 */
export async function handleIncomingMessage({ senderId, profileName, text, buttonId, igMessageId }) {
  if (igMessageId) {
    const isNew = await logMessage(null, "inbound", text, igMessageId);
    if (!isNew) return; // already processed this exact message (webhook retry)
  }

  const settings = await getSettings();
  let conversation = await getOrCreateConversation(senderId, profileName);

  // Backfill the conversation_id on the inbound log row now that we have it.
  if (igMessageId) {
    await supabase.from("ig_messages").update({ conversation_id: conversation.id }).eq("id", igMessageId);
  }

  const reply = async (body) => {
    await sendInstagramText(senderId, body);
    await logMessage(conversation.id, "outbound", body);
  };

  // --- Once-a-day welcome ---------------------------------------------
  // Return immediately after greeting: Instagram only shows quick-reply
  // buttons on the single most recent message in the thread, so if we kept
  // going and sent another reply right after (e.g. the AI fallback below),
  // that next message would instantly make the welcome buttons disappear.
  if (conversation.last_greeted_date !== todayStr()) {
    conversation = await updateConversation(conversation.id, { last_greeted_date: todayStr() });
    await sendWelcome(conversation, settings);
    return;
  }

  const input = (buttonId || text || "").trim();
  const normalized = input.toLowerCase();

  // --- Global reset commands -------------------------------------------
  if (["cancel", "restart", "reset"].includes(normalized)) {
    conversation = await updateConversation(conversation.id, {
      stage: "idle",
      customer_name: null,
      table_no: null,
      cart: [],
    });
    await reply("No problem, I've cleared that. Say \"order\" any time you're ready to start again 🙂");
    return;
  }

  // --- Start the order chain (quick-reply tap or typed "order") --------
  if (buttonId === BUTTON_ORDER || (conversation.stage === "idle" && normalized === "order")) {
    conversation = await updateConversation(conversation.id, { stage: "ask_name" });
    await reply("Great, let's get your order started! What name should I put on it?");
    return;
  }

  // --- Keyword automations (checked outside the structured data-entry
  // stages, so "location" mid-order isn't captured as someone's table
  // number) ---------------------------------------------------------------
  if (!["ask_name", "ask_table", "ask_items", "confirm"].includes(conversation.stage) || buttonId) {
    if (buttonId === BUTTON_LOCATION || buttonId === BUTTON_MENU) {
      const match = await findKeywordMatch(buttonId === BUTTON_LOCATION ? "location" : "menu price");
      if (match) {
        await reply(match.response);
        return;
      }
    }
    const match = await findKeywordMatch(input);
    if (match) {
      await reply(match.response);
      return;
    }
  }

  // --- Stage machine -----------------------------------------------------
  switch (conversation.stage) {
    case "ask_name": {
      if (!input) {
        await reply("Sorry, what name should I put on the order?");
        return;
      }
      conversation = await updateConversation(conversation.id, { customer_name: input, stage: "ask_table" });
      await reply(`Thanks, ${input}! What table number are you at?`);
      return;
    }

    case "ask_table": {
      if (!input) {
        await reply("What table number are you at?");
        return;
      }
      conversation = await updateConversation(conversation.id, { table_no: input, stage: "ask_items" });
      await reply('What would you like to order? You can just type it naturally, e.g. "2 simit and a tea".');
      return;
    }

    case "ask_items": {
      const products = await getActiveMenu();
      let matched;
      try {
        matched = await matchItemsWithAI(input, products);
      } catch (err) {
        console.error("matchItemsWithAI (Instagram) failed:", err.message);
        await reply("Sorry, I had trouble reading that - could you list the items again?");
        return;
      }

      const existingCart = Array.isArray(conversation.cart) ? conversation.cart : [];
      const cart = [...existingCart];
      for (const item of matched.items) {
        const existing = cart.find((c) => c.slug === item.slug);
        if (existing) existing.quantity += item.quantity;
        else cart.push(item);
      }

      if (cart.length === 0) {
        await reply("I couldn't match that to anything on the menu - could you try naming the items again?");
        return;
      }

      conversation = await updateConversation(conversation.id, { cart, stage: "confirm" });

      let summary = `Here's your order so far:\n\n${formatCart(cart)}\n\nTotal: ${cartTotal(cart)} ${cart[0].currency}`;
      if (matched.unmatchedText) {
        summary += `\n\n(I couldn't match "${matched.unmatchedText}" to anything on the menu, so I left it out.)`;
      }
      await sendInstagramText(senderId, summary);
      await logMessage(conversation.id, "outbound", summary);
      await sendInstagramButtons(senderId, "Ready to send this to the kitchen?", [
        { id: BUTTON_CONFIRM, title: "✅ Confirm" },
        { id: BUTTON_MODIFY, title: "✏️ Add / change" },
      ]);
      return;
    }

    case "confirm": {
      if (buttonId === BUTTON_MODIFY) {
        conversation = await updateConversation(conversation.id, { stage: "ask_items" });
        await reply("Sure - what would you like to add or change?");
        return;
      }
      if (buttonId === BUTTON_CONFIRM || normalized === "confirm") {
        const cart = Array.isArray(conversation.cart) ? conversation.cart : [];
        if (cart.length === 0) {
          conversation = await updateConversation(conversation.id, { stage: "ask_items" });
          await reply("Looks like the cart's empty - what would you like to order?");
          return;
        }

        // Atomically claim this confirmation before creating the order.
        // This is the actual fix for double-recorded Instagram orders:
        // "Confirm" is a button-template tap, which arrives as a
        // `messaging_postbacks` event that often has no `mid` at all, so the
        // message-id dedupe above (keyed on igMessageId) has nothing to key
        // on and can't catch Meta redelivering the same tap. This
        // conditional update only succeeds for whichever delivery gets here
        // first - it flips stage confirm -> placing_order and returns the
        // row; a loser sees zero rows matched and bails out below without
        // ever touching the orders table.
        const { data: claimed, error: claimError } = await supabase
          .from("ig_conversations")
          .update({ stage: "placing_order", last_message_at: new Date().toISOString(), followup_sent: false })
          .eq("id", conversation.id)
          .eq("stage", "confirm")
          .select()
          .maybeSingle();
        if (claimError) {
          console.error("Instagram confirm claim failed:", claimError.message);
          await reply("Sorry, something went wrong placing that order - please try confirming again.");
          return;
        }
        if (!claimed) {
          // Already claimed by a near-simultaneous delivery of this same
          // confirm - that other call is placing (or already placed) the
          // order, so do nothing here to avoid a duplicate.
          return;
        }
        conversation = claimed;

        const { data: order, error: orderError } = await supabase
          .from("orders")
          .insert({
            order_code: generateOrderCode(),
            channel: "instagram",
            customer_name: conversation.customer_name,
            table_no: conversation.table_no,
            lang: "en",
            total: cartTotal(cart),
            currency: cart[0].currency,
            status: "on_queue",
          })
          .select()
          .single();
        if (orderError) {
          console.error("Instagram order insert failed:", orderError.message);
          // Release the claim so the customer can retry confirming.
          await updateConversation(conversation.id, { stage: "confirm" });
          await reply("Sorry, something went wrong placing that order - please try confirming again.");
          return;
        }

        const { error: itemsError } = await supabase.from("order_items").insert(
          cart.map((c) => ({
            order_id: order.id,
            product_id: c.productId,
            product_name: c.name,
            quantity: c.quantity,
            unit_price: c.price,
          }))
        );
        if (itemsError) console.error("Instagram order_items insert failed:", itemsError.message);

        conversation = await updateConversation(conversation.id, {
          stage: "idle",
          customer_name: null,
          table_no: null,
          cart: [],
        });

        await reply(`🎉 Order placed! Your order code is ${order.order_code}. We'll bring it to your table shortly.`);
        await notifyOwner(
          settings,
          { ...order, items: cart.map((c) => ({ product_name: c.name, quantity: c.quantity, unit_price: c.price })) },
          conversation
        );
        return;
      }
      await reply('Tap "Confirm" to send this order, or "Add / change" to modify it.');
      return;
    }

    default: {
      // idle, nothing matched a keyword or a command - fall back to a
      // grounded AI answer rather than going silent.
      const products = await getActiveMenu();
      const answer = await aiFallbackReply(input, products, settings.order_button_label);
      await reply(answer);
    }
  }
}

/**
 * Polls for conversations that have gone quiet mid-flow and sends the
 * admin-configured follow-up nudge once. Same setInterval-driven pattern as
 * waBot.js's sendPendingFollowups.
 */
export async function sendPendingIgFollowups() {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - settings.followup_delay_minutes * 60 * 1000).toISOString();

  const { data: stale, error } = await supabase
    .from("ig_conversations")
    .select("id, sender_id")
    .neq("stage", "idle")
    .eq("followup_sent", false)
    .lt("last_message_at", cutoff);
  if (error) {
    console.error("sendPendingIgFollowups query failed:", error.message);
    return;
  }

  for (const convo of stale) {
    try {
      await sendInstagramText(convo.sender_id, settings.followup_message);
    } catch (err) {
      console.error(`Instagram follow-up to ${convo.sender_id} failed:`, err.message);
    } finally {
      // Mark as sent whether or not it actually went through - this is a
      // best-effort, once-only nudge, not something we want retried every
      // minute forever (e.g. while an access token is expired).
      await supabase.from("ig_conversations").update({ followup_sent: true }).eq("id", convo.id);
    }
  }
}
