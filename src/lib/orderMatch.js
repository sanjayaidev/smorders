import { supabase } from "../supabaseClient.js";
import { callDashScopeChat } from "./dashscope.js";

/** Live, orderable menu - shared by every messaging channel's bot. */
export async function getActiveMenu() {
  const { data: products, error } = await supabase
    .from("products")
    .select("id, slug, name, price, currency")
    .eq("active", true)
    .eq("coming_soon", false);
  if (error) throw error;
  return products;
}

/**
 * Uses the same grounded-JSON pattern as the web assistant (src/routes/assistant.js):
 * give the model the real menu, ask it to match freeform text to slugs +
 * quantities, then validate everything it returns against the real product
 * list before trusting a single price or name. The model can hallucinate a
 * slug; the price shown to the customer never comes from the model itself.
 */
export async function matchItemsWithAI(text, products) {
  const menuForPrompt = products.map((p) => ({
    slug: p.slug,
    name: p.name?.en || Object.values(p.name || {})[0] || p.slug,
    price: p.price,
  }));

  const messages = [
    {
      role: "system",
      content: `Match the customer's freeform order text to items from this menu. Reply with ONLY this JSON shape, no commentary:
{"items": [{"slug": "<menu slug>", "quantity": <integer>}], "unmatchedText": "<any part of the message you couldn't match to a menu item, or empty string>"}
Only use slugs that appear in MENU below - never invent one. If quantity isn't stated, use 1.

MENU:
${JSON.stringify(menuForPrompt)}`,
    },
    { role: "user", content: text.slice(0, 1000) },
  ];

  const raw = await callDashScopeChat(messages);
  const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);

  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((i) => {
      const product = bySlug.get(i?.slug);
      if (!product) return null;
      const quantity = Math.max(1, Math.min(20, parseInt(i.quantity, 10) || 1));
      return {
        productId: product.id,
        slug: product.slug,
        name: product.name?.en || Object.values(product.name || {})[0] || product.slug,
        price: product.price,
        currency: product.currency,
        quantity,
      };
    })
    .filter(Boolean);

  return { items, unmatchedText: typeof parsed.unmatchedText === "string" ? parsed.unmatchedText : "" };
}

/** Freeform Q&A fallback for when nothing else matched - grounded in the real menu so it can't invent prices or items. */
export async function aiFallbackReply(text, products, orderButtonLabel) {
  const menuForPrompt = products.map((p) => ({
    name: p.name?.en || Object.values(p.name || {})[0] || p.slug,
    price: p.price,
    currency: p.currency,
  }));
  const messages = [
    {
      role: "system",
      content: `You are a friendly ordering assistant for a food business, chatting over direct message. Answer the customer's question briefly (2-3 sentences max, chat style, no markdown). If they seem to want to order food, tell them to reply "order" or use the menu button. Reply with ONLY this JSON: {"reply": "<text>"}.

MENU:
${JSON.stringify(menuForPrompt)}`,
    },
    { role: "user", content: text.slice(0, 1000) },
  ];
  try {
    const raw = await callDashScopeChat(messages);
    const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.reply === "string" && parsed.reply.trim()) return parsed.reply.trim();
  } catch (err) {
    console.error("aiFallbackReply failed:", err.message);
  }
  return `Sorry, I didn't quite catch that. Reply "${orderButtonLabel}" to place an order, or ask me anything else!`;
}

export function formatCart(cart) {
  return cart.map((i) => `${i.quantity}× ${i.name} - ${i.price * i.quantity} ${i.currency}`).join("\n");
}

export function cartTotal(cart) {
  return cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
}
