import "./env.js";
import { createFakeDb } from "./fakeSupabase.js";

const NAMES = {
  simit: { en: "Classic Simit", tr: "Klasik Simit", kk: "Қарапайым симит", ru: "Классический симит" },
  baklava: { en: "Pistachio Baklava", tr: "Fıstıklı Baklava", kk: "Фисташкалы баклава", ru: "Баклава с фисташками" },
  kavurma: { en: "Kavurma (Slow-Roasted Meat)", tr: "Kavurma", kk: "Қуырылған ет", ru: "Кавурма (томлёное мясо)" },
};

export const PRODUCTS = [
  { id: "p-simit", slug: "klasik-simit", category_id: "c-simit", emoji: "🥯", price: 500, currency: "KZT", weight_note: null, active: true, coming_soon: false, sort_order: 1, name: NAMES.simit },
  { id: "p-baklava", slug: "fistikli-baklava", category_id: "c-dessert", emoji: "🍰", price: 9000, currency: "KZT", weight_note: "1 kg", active: true, coming_soon: false, sort_order: 1, name: NAMES.baklava },
  { id: "p-kavurma", slug: "kavurma", category_id: "c-meat", emoji: "🥩", price: 15000, currency: "KZT", weight_note: "1 kg", active: true, coming_soon: false, sort_order: 1, name: NAMES.kavurma },
  { id: "p-soon", slug: "nutella-simit", category_id: "c-simit", emoji: "🍫", price: 1650, currency: "KZT", weight_note: null, active: true, coming_soon: true, sort_order: 5, name: { en: "Nutella Simit", ru: "Симит с Nutella" } },
];

export const CATEGORIES = [
  { id: "c-simit", icon: "🥯", sort_order: 1, active: true, name: { en: "Simit", ru: "Симит", kk: "Симит", tr: "Simit" } },
  { id: "c-meat", icon: "🥩", sort_order: 2, active: true, name: { en: "Deli", ru: "Мясные деликатесы", kk: "Ет", tr: "Şarküteri" } },
  { id: "c-dessert", icon: "🍰", sort_order: 3, active: true, name: { en: "Desserts", ru: "Десерты", kk: "Тәттілер", tr: "Tatlılar" } },
];

export const SETTINGS = {
  id: 1,
  welcome_message: "👋 Welcome!",
  order_button_label: "🛒 Place an order",
  location_button_label: "📍 Location",
  menu_button_label: "💰 Menu & prices",
  followup_message: "Still there?",
  followup_delay_minutes: 15,
  owner_test_id: "owner-1",
};

/**
 * Build an engine wired to a fake database and recording senders.
 * `matchItems` decides what the (stubbed) AI understood.
 */
export async function makeHarness({ config = {}, matchItems, keywords = [], now = () => new Date("2026-09-20T12:00:00Z"), dbOptions = {} } = {}) {
  const { createBotEngine } = await import("../../src/lib/botEngine.js");
  const db = createFakeDb({
    tables: {
      products: PRODUCTS,
      categories: CATEGORIES,
      t_settings: [SETTINGS],
      t_keywords: keywords.map((k, i) => ({ id: `k${i}`, active: true, sort_order: i, match_type: "contains", ...k })),
    },
    defaults: {
      t_conversations: { stage: "idle", cart: [], language: "en", followup_sent: false, last_greeted_date: null, last_message_at: now().toISOString() },
    },
    uniqueKeys: { t_messages: "id" },
    ...dbOptions,
  });

  const sent = []; // every text/button the bot sent
  const engine = createBotEngine(
    {
      channel: "whatsapp",
      label: "Test",
      tables: { settings: "t_settings", conversations: "t_conversations", messages: "t_messages", keywords: "t_keywords" },
      userColumn: "phone_number",
      ownerColumn: "owner_test_id",
      textLimit: 3800,
      welcomeEndsTurn: false,
      sendText: async (to, text) => { sent.push({ to, text }); },
      sendButtons: async (to, body, buttons) => { sent.push({ to, text: body, buttons }); },
      ...config,
    },
    {
      db,
      now,
      ai: {
        localize: async (text, language) => (language === "en" ? text : `[${language}] ${text}`),
        fallbackReply: async () => "AI-FALLBACK",
        matchItems: matchItems || (async () => ({ items: [], unmatchedText: "" })),
      },
    }
  );

  let messageCounter = 0;
  const say = async (userId, text, extra = {}) => {
    const before = sent.length;
    await engine.handleIncoming({ userId, text, messageId: `m${++messageCounter}`, ...extra });
    return sent.slice(before);
  };
  const tap = (userId, buttonId, title = "") => say(userId, title, { buttonId });
  const texts = (messages) => messages.map((m) => m.text).join("\n---\n");

  return { engine, db, sent, say, tap, texts, now };
}

/** A matcher stub: 'simit' -> add 2 classic simit, etc. Understands a few remove/set phrases. */
export function simpleMatcher() {
  const bySlug = Object.fromEntries(PRODUCTS.map((p) => [p.slug, p]));
  const line = (slug, quantity, action = "add") => {
    const p = bySlug[slug];
    return { productId: p.id, slug, name: p.name.en, names: p.name, price: p.price, currency: p.currency, quantity, action };
  };
  return async (text) => {
    const value = text.toLowerCase();
    if (/remove|убери|çıkar/.test(value)) return { items: [line("klasik-simit", null, "remove")], unmatchedText: "" };
    if (/make it 3/.test(value)) return { items: [line("klasik-simit", 3, "set")], unmatchedText: "" };
    if (/simit|симит/.test(value)) return { items: [line("klasik-simit", 2)], unmatchedText: value.includes("pizza") ? "pizza" : "" };
    if (/baklava|баклав/.test(value)) return { items: [line("fistikli-baklava", 1)], unmatchedText: "" };
    return { items: [], unmatchedText: text };
  };
}
