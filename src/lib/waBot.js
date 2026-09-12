import { supabase } from "../supabaseClient.js";
import { generateOrderCode } from "./orderCode.js";
import { sendWhatsAppText, sendWhatsAppButtons } from "./whatsapp.js";
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
  const { data, error } = await supabase.from("wa_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

async function getOrCreateConversation(phoneNumber, profileName) {
  const { data: existing, error } = await supabase
    .from("wa_conversations")
    .select("*")
    .eq("phone_number", phoneNumber)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from("wa_conversations")
    .insert({ phone_number: phoneNumber, profile_name: profileName || null })
    .select()
    .single();
  if (insertError) throw insertError;
  return created;
}

async function updateConversation(id, patch) {
  const { data, error } = await supabase
    .from("wa_conversations")
    .update({ ...patch, last_message_at: new Date().toISOString(), followup_sent: false })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function logMessage(conversationId, direction, body, waMessageId) {
  // waMessageId is only present (and used as the PK) for inbound messages,
  // which is what lets us dedupe webhook retries. Outbound log rows get a
  // random id since Graph API message ids for sends aren't threaded back
  // here synchronously in every code path.
  const id = waMessageId || `out_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { error } = await supabase
    .from("wa_messages")
    .insert({ id, conversation_id: conversationId, direction, body });
  // Ignore unique-violation (23505) - it just means we've already logged
  // (and therefore already processed) this exact inbound message id.
  if (error && error.code !== "23505") console.error("wa_messages insert failed:", error.message);
  return !error || error.code !== "23505";
}

async function findKeywordMatch(text) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  const { data: keywords, error } = await supabase
    .from("wa_keywords")
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
  await sendWhatsAppText(conversation.phone_number, settings.welcome_message);
  await sendWhatsAppButtons(conversation.phone_number, "What would you like to do?", [
    { id: BUTTON_ORDER, title: settings.order_button_label },
    { id: BUTTON_LOCATION, title: settings.location_button_label },
    { id: BUTTON_MENU, title: settings.menu_button_label },
  ]);
}

async function notifyOwner(settings, conversation, order) {
  if (!settings.owner_whatsapp_number) return;
  const lines = order.items
    .map((i) => `${i.quantity}× ${i.product_name} - ${i.unit_price * i.quantity} ${order.currency}`)
    .join("\n");
  const text =
    `🔔 New order ${order.order_code}\n` +
    `Name: ${order.customer_name}\n` +
    `Table: ${order.table_no}\n\n` +
    `${lines}\n\nTotal: ${order.total} ${order.currency}`;
  try {
    await sendWhatsAppText(settings.owner_whatsapp_number, text);
  } catch (err) {
    // Most likely cause: the owner hasn't messaged this WhatsApp number in
    // the last 24h ("outside the customer service window"), and this isn't
    // a pre-approved template message, so Meta refuses to deliver it. The
    // order itself is already saved and visible on /admin either way - this
    // notification is best-effort on top of that, not the source of truth.
    console.error("notifyOwner failed (likely outside 24h window):", err.message);
  }
}

/**
 * Entry point called by the webhook route for every inbound customer
 * message. Handles: the once-a-day welcome, admin-defined keyword
 * automations, and the built-in Name -> Table -> Items -> Confirm order
 * chain. Never throws for "normal" flow issues - errors are logged and the
 * customer gets a graceful fallback reply instead of silence.
 */
export async function handleIncomingMessage({ phoneNumber, profileName, text, buttonId, waMessageId }) {
  if (waMessageId) {
    const isNew = await logMessage(null, "inbound", text, waMessageId);
    if (!isNew) return; // already processed this exact message (webhook retry)
  }

  const settings = await getSettings();
  let conversation = await getOrCreateConversation(phoneNumber, profileName);

  // Backfill the conversation_id on the inbound log row now that we have it.
  if (waMessageId) {
    await supabase.from("wa_messages").update({ conversation_id: conversation.id }).eq("id", waMessageId);
  }

  const reply = async (body) => {
    await sendWhatsAppText(phoneNumber, body);
    await logMessage(conversation.id, "outbound", body);
  };

  // --- Once-a-day welcome ---------------------------------------------
  if (conversation.last_greeted_date !== todayStr()) {
    conversation = await updateConversation(conversation.id, { last_greeted_date: todayStr() });
    await sendWelcome(conversation, settings);
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

  // --- Start the order chain (button tap or typed "order") -------------
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
        console.error("matchItemsWithAI failed:", err.message);
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
      await sendWhatsAppText(phoneNumber, summary);
      await logMessage(conversation.id, "outbound", summary);
      await sendWhatsAppButtons(phoneNumber, "Ready to send this to the kitchen?", [
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

        const { data: order, error: orderError } = await supabase
          .from("orders")
          .insert({
            order_code: generateOrderCode(),
            channel: "whatsapp",
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
          console.error("WhatsApp order insert failed:", orderError.message);
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
        if (itemsError) console.error("WhatsApp order_items insert failed:", itemsError.message);

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
 * admin-configured follow-up nudge once. Intended to be run on an interval
 * from index.js - this app is a long-running Node process (not serverless),
 * so a simple setInterval is a reasonable stand-in for a real job queue here.
 */
export async function sendPendingFollowups() {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - settings.followup_delay_minutes * 60 * 1000).toISOString();

  const { data: stale, error } = await supabase
    .from("wa_conversations")
    .select("id, phone_number")
    .neq("stage", "idle")
    .eq("followup_sent", false)
    .lt("last_message_at", cutoff);
  if (error) {
    console.error("sendPendingFollowups query failed:", error.message);
    return;
  }

  for (const convo of stale) {
    try {
      await sendWhatsAppText(convo.phone_number, settings.followup_message);
    } catch (err) {
      // Code 131047 = the 24-hour customer service window closed before we
      // could send this free-form follow-up; code 190 = access token
      // invalid/expired. Distinguish them so the log points at the actual
      // fix (increase urgency / use a template vs. re-auth in admin).
      const code = err.whatsappError?.code;
      if (code === 131047) {
        console.error(
          `Follow-up to ${convo.phone_number} skipped: the 24-hour customer service window had already closed (consider lowering followup_delay_minutes).`
        );
      } else {
        console.error(`Follow-up to ${convo.phone_number} failed:`, err.message);
      }
    } finally {
      // Mark as sent whether or not it actually went through - this is a
      // best-effort, once-only nudge, not something we want retried every
      // minute forever (e.g. while an access token is expired).
      await supabase.from("wa_conversations").update({ followup_sent: true }).eq("id", convo.id);
    }
  }
}
