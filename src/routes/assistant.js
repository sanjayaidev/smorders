import { Router } from "express";
import { supabase } from "../supabaseClient.js";
import { callDashScopeChat } from "../lib/dashscope.js";

const router = Router();

const LANG_NAMES = { en: "English", tr: "Turkish", kk: "Kazakh", ru: "Russian" };

const SYSTEM_PROMPT_INTRO = `You are "Simit", the friendly ordering assistant for Simit Astana, a Turkish/Central-Asian bakery-cafe kiosk. Customers write in English, Turkish, Kazakh, or Russian - always reply in the SAME language they used.

Your only job is to help them build their order in the chat and tell you when they're ready to send it to the kitchen. You have no tools - you respond with a single JSON object and nothing else (no markdown code fences, no commentary outside the JSON).

Only ever reference menu items by the exact "slug" values given in the MENU list below - never invent items, prices, or availability that aren't listed. If someone asks for something not on the menu, say so kindly in "reply" and leave "addItems" empty for that item.

Respond with EXACTLY this JSON shape and nothing else:
{
  "reply": "<your natural-language reply to show the customer, in their language>",
  "addItems": [{ "slug": "<menu item slug>", "quantity": <integer> }],
  "customerName": <"the name" if the customer just told you their name this message, else null>,
  "tableNo": <"the table number" if the customer just told you this message, else null>,
  "placeOrder": <true only if the customer clearly wants to send the order to the kitchen right now - e.g. "place my order", "that's everything, confirm it", "тапсырысты растаймын", "siparişi onayla">
}`;

/**
 * POST /api/assistant/chat
 * body: {
 *   message: string,
 *   lang?: "en"|"tr"|"kk"|"ru",
 *   history?: [{ role: "user"|"assistant", content: string }],
 *   cart?: [{ slug: string, quantity: number }],
 *   customerName?: string,
 *   tableNo?: string,
 * }
 *
 * Returns: { reply, addItems: [{productId, slug, name, price, currency, quantity}], customerName, tableNo, placeOrder }
 *
 * The model only ever *suggests* actions - actually placing an order still
 * goes through the normal, price-verified POST /api/orders route on the
 * client side. This endpoint never writes to the database itself.
 */
router.post("/chat", async (req, res, next) => {
  try {
    const { message, lang = "en", history = [], cart = [], customerName, tableNo } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required." });
    }

    // Ground the model in the real, current menu so it can't hallucinate
    // items, prices, or availability.
    const { data: categories, error: catError } = await supabase
      .from("categories")
      .select("id, name")
      .eq("active", true);
    if (catError) throw catError;
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name?.en || ""]));

    const { data: products, error: prodError } = await supabase
      .from("products")
      .select("id, category_id, slug, name, description, price, currency, weight_note, active, coming_soon")
      .eq("active", true)
      .eq("coming_soon", false);
    if (prodError) throw prodError;

    const menuForPrompt = products.map((p) => ({
      slug: p.slug,
      category: categoryNameById.get(p.category_id) || "",
      name: p.name,
      description: p.description,
      price: p.price,
      currency: p.currency,
      ...(p.weight_note ? { weight_note: p.weight_note } : {}),
    }));

    const systemPrompt = `${SYSTEM_PROMPT_INTRO}

The customer is currently writing in: ${LANG_NAMES[lang] || "English"}.
Known so far - customerName: ${customerName || "unknown"}, tableNo: ${tableNo || "unknown"}.
Current cart (slug × quantity): ${cart.length ? cart.map((c) => `${c.slug}×${c.quantity}`).join(", ") : "empty"}.

MENU:
${JSON.stringify(menuForPrompt)}`;

    const trimmedHistory = (Array.isArray(history) ? history : []).slice(-8).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 1000),
    }));

    const messages = [
      { role: "system", content: systemPrompt },
      ...trimmedHistory,
      { role: "user", content: message.slice(0, 1000) },
    ];

    let parsed;
    try {
      const raw = await callDashScopeChat(messages);
      const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error("Assistant error:", err.message);
      return res.status(502).json({ error: "The order assistant is unavailable right now." });
    }

    // Resolve + validate addItems against the real menu - never trust the
    // model's output blindly, since it's the thing deciding what goes in
    // someone's cart.
    const productBySlug = new Map(products.map((p) => [p.slug, p]));
    const addItems = (Array.isArray(parsed.addItems) ? parsed.addItems : [])
      .map((item) => {
        const product = productBySlug.get(item?.slug);
        if (!product) return null;
        const quantity = Math.max(1, Math.min(20, Number(item.quantity) || 1));
        return {
          productId: product.id,
          slug: product.slug,
          name: product.name,
          price: product.price,
          currency: product.currency,
          quantity,
        };
      })
      .filter(Boolean);

    res.json({
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
      addItems,
      customerName: typeof parsed.customerName === "string" ? parsed.customerName : null,
      tableNo: typeof parsed.tableNo === "string" ? parsed.tableNo : null,
      placeOrder: Boolean(parsed.placeOrder),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
