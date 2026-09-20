import { supabase } from "../supabaseClient.js";
import { callDashScopeChat } from "./dashscope.js";
import { LANGUAGE_NAMES, t, pickName } from "./botI18n.js";

const MAX_LINE_QUANTITY = 50;
const MAX_MENTION_QUANTITY = 20;

/** Live, orderable menu - shared by every messaging channel's bot. */
export async function getActiveMenu(db = supabase) {
  const { data: products, error } = await db
    .from("products")
    .select("id, slug, name, price, currency")
    .eq("active", true)
    .eq("coming_soon", false);
  if (error) throw error;
  return products;
}

export async function getKnowledgeBase(db = supabase) {
  const { data, error } = await db
    .from("wb_knowledge_base")
    .select("title, content, priority")
    .eq("active", true)
    .order("priority", { ascending: false })
    .limit(30);
  if (error) {
    console.error("getKnowledgeBase failed:", error.message);
    return [];
  }
  return data || [];
}

/** Every distinct name a product has, across languages (for the AI matcher). */
function allNames(product) {
  const names = Object.values(product.name || {}).filter(Boolean);
  return [...new Set(names.length ? names : [product.slug])];
}

function stripJsonFences(raw) {
  return String(raw).trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
}

/**
 * Uses the same grounded-JSON pattern as the web assistant (src/routes/assistant.js):
 * give the model the real menu, ask it to turn freeform text into changes to
 * the order, then validate everything it returns against the real product
 * list before trusting a single price or name. The model can hallucinate a
 * slug; the price shown to the customer never comes from the model itself.
 *
 * Each returned item carries an `action`:
 *   add    - more of this item (the default; "2 simit and a baklava")
 *   set    - exactly this many ("make it 3", "change the simit to 2")
 *   remove - take it out, or take `quantity` off if a number was given
 *
 * @param {string} text        the customer's message
 * @param {Array} products     result of getActiveMenu()
 * @param {string} language    customer language code
 * @param {Array} [cart]       the current cart, so "remove"/"make it 3" have something to refer to
 * @param {Function} [chat]    chat-completion function (injectable for tests)
 */
export async function matchItemsWithAI(text, products, language = "en", cart = [], chat = callDashScopeChat) {
  const menuForPrompt = products.map((p) => ({ slug: p.slug, names: allNames(p), price: p.price }));
  const cartForPrompt = (Array.isArray(cart) ? cart : []).map((c) => ({ slug: c.slug, quantity: c.quantity }));
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.en;

  const messages = [
    {
      role: "system",
      content: `Turn the customer's freeform message into changes to their food order, using ONLY items from the MENU below. The customer writes in ${languageName}; each menu item lists its names in several languages, and the customer may use any of them or a common spelling of them.
Reply with ONLY this JSON shape, no commentary:
{"items": [{"slug": "<menu slug>", "quantity": <integer or null>, "action": "add" | "set" | "remove"}], "unmatchedText": "<any part of the message you couldn't match to a menu item, or empty string>"}
Rules:
- "add" (the default): the customer wants more of the item. If no quantity is stated use 1.
- "set": the customer wants exactly this quantity in total (e.g. "make it 3", "change the simit to 2").
- "remove": the customer wants the item taken out (e.g. "remove the simit", "no baklava"). Use quantity null to remove it completely, or a number only if they name how many to take off.
- Only use slugs that appear in MENU - never invent one.
- CART is what they have ordered so far; use it to understand references like "make it 3" or "remove that".

MENU:
${JSON.stringify(menuForPrompt)}

CART:
${JSON.stringify(cartForPrompt)}`,
    },
    { role: "user", content: String(text).slice(0, 1000) },
  ];

  const raw = await chat(messages);
  const parsed = JSON.parse(stripJsonFences(raw));

  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((entry) => {
      const product = bySlug.get(entry?.slug);
      if (!product) return null;

      let action = ["add", "set", "remove"].includes(entry.action) ? entry.action : "add";
      const parsedQuantity = parseInt(entry.quantity, 10);
      let quantity;
      if (action === "remove") {
        quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? Math.min(parsedQuantity, MAX_MENTION_QUANTITY) : null;
      } else if (action === "set" && parsedQuantity === 0) {
        action = "remove";
        quantity = null;
      } else {
        quantity = Math.max(1, Math.min(MAX_MENTION_QUANTITY, Number.isFinite(parsedQuantity) ? parsedQuantity : 1));
      }
      return {
        productId: product.id,
        slug: product.slug,
        name: pickName(product.name, "en") || product.slug,
        names: product.name || {},
        price: product.price,
        currency: product.currency,
        quantity,
        action,
      };
    })
    .filter(Boolean);

  return { items, unmatchedText: typeof parsed.unmatchedText === "string" ? parsed.unmatchedText : "" };
}

/**
 * Apply the changes returned by matchItemsWithAI() to a cart and return the
 * new cart (the input is not modified). Cart lines never keep the transient
 * `action` field.
 */
export function applyCartChanges(cart, changes) {
  const next = (Array.isArray(cart) ? cart : []).map((line) => ({ ...line }));
  for (const change of changes) {
    const index = next.findIndex((line) => line.slug === change.slug);
    const { action, ...line } = change;

    if (action === "remove") {
      if (index === -1) continue;
      if (change.quantity == null) next.splice(index, 1);
      else {
        next[index].quantity -= change.quantity;
        if (next[index].quantity <= 0) next.splice(index, 1);
      }
    } else if (action === "set") {
      if (index === -1) next.push(line);
      else next[index].quantity = change.quantity;
    } else if (index === -1) {
      next.push(line);
    } else {
      next[index].quantity = Math.min(next[index].quantity + change.quantity, MAX_LINE_QUANTITY);
    }
  }
  return next;
}

/**
 * Freeform Q&A fallback for when nothing else matched - grounded in the real
 * menu so it can't invent prices or items.
 */
export async function aiFallbackReply(text, products, language = "en", { chat = callDashScopeChat, db = supabase } = {}) {
  const menuForPrompt = products.map((p) => ({
    name: pickName(p.name, language) || pickName(p.name, "en") || p.slug,
    price: p.price,
    currency: p.currency,
  }));
  const knowledge = await getKnowledgeBase(db);
  const knowledgeText = knowledge.length
    ? `\nKNOWLEDGE BASE:\n${knowledge.map((entry) => `## ${entry.title}\n${entry.content}`).join("\n\n")}`
    : "";
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.en;
  const messages = [
    {
      role: "system",
      content: `You are a friendly ordering assistant for a food business, chatting over direct message. Answer in ${languageName}, matching the customer's language. Use the knowledge base when the question does not match a specific keyword. Only state facts supported by the menu or knowledge base; if the answer is not known, say so briefly and invite the customer to ask about ordering. Answer briefly (2-3 sentences max, chat style, no markdown). If they seem to want to order food, tell them to send "order" (or use the menu button). Reply with ONLY this JSON: {"reply": "<text>"}.

MENU:
${JSON.stringify(menuForPrompt)}${knowledgeText}`,
    },
    { role: "user", content: String(text).slice(0, 1000) },
  ];
  try {
    const raw = await chat(messages);
    const parsed = JSON.parse(stripJsonFences(raw));
    if (typeof parsed.reply === "string" && parsed.reply.trim()) return parsed.reply.trim();
  } catch (err) {
    console.error("aiFallbackReply failed:", err.message);
  }
  return t(language, "fallbackSorry");
}

/** "2× Classic Simit - 1000 KZT" per line, names in the customer's language. */
export function formatCart(cart, language = "en") {
  return cart
    .map((i) => `${i.quantity}× ${pickName(i.names, language) || i.name} - ${i.price * i.quantity} ${i.currency}`)
    .join("\n");
}

export function cartTotal(cart) {
  return cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
}
