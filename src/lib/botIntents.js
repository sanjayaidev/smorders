/**
 * Built-in chat commands, recognised in English, Russian, Kazakh and Turkish.
 *
 * Before this existed the bots only understood a handful of English words
 * ("order", "cancel", "restart", "reset"), so a Russian customer typing
 * "отмена" or "меню" was treated as a name, a table number or an item.
 *
 * Matching is by WHOLE phrase (after normalising case and punctuation), never
 * by substring - otherwise an item like "menu special" or a customer named
 * "Status" would be hijacked. The one exception is the small alias tables at
 * the bottom, which map free-form questions ("where are you?", "адрес") onto
 * the admin-managed keyword rules and are only used outside the order flow.
 */

/** Lowercase, drop punctuation/emoji, collapse whitespace. */
export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u0307\uFE0F\u200D]/g, "") // dotted-İ artefact, emoji variation selector, ZWJ
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const set = (...phrases) => new Set(phrases.map(normalizeText));

// Order matters only for phrases that appear in more than one list; those are
// avoided on purpose, so it is mostly informational.
const GLOBAL_INTENTS = [
  [
    "cancel",
    set(
      "cancel", "cancel order", "restart", "reset", "start over", "stop",
      "отмена", "отменить", "отменить заказ", "сброс", "сбросить", "заново", "начать заново",
      "бас тарту", "болдырмау", "қайта бастау", "тоқтату",
      "iptal", "iptal et", "vazgeç", "yeniden başla", "sıfırla", "baştan"
    ),
  ],
  [
    "status",
    set(
      "status", "order status", "my order", "my orders", "where is my order", "check order", "check status",
      "статус", "статус заказа", "мой заказ", "где мой заказ", "проверить заказ",
      "күй", "күйі", "тапсырыс күйі", "менің тапсырысым", "тапсырысым қайда",
      "durum", "sipariş durumu", "siparişim", "siparişim nerede"
    ),
  ],
  [
    "menu",
    set(
      "menu", "the menu", "show menu", "show me the menu", "menu and prices", "menu prices", "price", "prices", "price list",
      "меню", "покажи меню", "покажите меню", "цена", "цены", "прайс", "прайс лист",
      "мәзір", "мәзірді көрсет", "баға", "бағасы", "бағалар",
      "menü", "menüyü göster", "fiyat", "fiyatlar", "fiyat listesi"
    ),
  ],
  [
    "cart",
    set(
      "cart", "my cart", "basket", "view cart", "show cart",
      "корзина", "моя корзина", "покажи корзину",
      "себет", "менің себетім",
      "sepet", "sepetim"
    ),
  ],
  [
    "clear",
    set(
      "clear cart", "empty cart", "clear",
      "очистить корзину", "очистить",
      "себетті тазала", "себетті тазалау",
      "sepeti boşalt", "sepeti temizle"
    ),
  ],
  [
    "help",
    set(
      "help", "commands", "how to order", "how does this work",
      "помощь", "помоги", "команды", "как заказать",
      "көмек", "көмектес", "қалай тапсырыс беремін",
      "yardım", "komutlar", "nasıl sipariş"
    ),
  ],
  ["back", set("back", "go back", "назад", "артқа", "geri")],
  [
    "order",
    set(
      "order", "new order", "start order", "place order", "i want to order", "i would like to order",
      "заказ", "заказать", "новый заказ", "хочу заказать", "сделать заказ",
      "тапсырыс", "тапсырыс беру", "жаңа тапсырыс",
      "sipariş", "sipariş ver", "yeni sipariş", "siparis", "siparis ver"
    ),
  ],
];

// Only meaningful while the customer is looking at their order summary.
const CONFIRM_PHRASES = set(
  "confirm", "confirm order", "place order", "yes", "yep", "ok", "okay",
  "да", "подтверждаю", "подтвердить", "заказать", "ок", "хорошо",
  "растаймын", "растау", "иә", "иа", "жарайды",
  "evet", "onayla", "tamam"
);
const MODIFY_PHRASES = set(
  "no", "change", "edit", "add", "modify",
  "нет", "изменить", "добавить", "изменение",
  "жоқ", "өзгерту", "қосу",
  "hayır", "değiştir", "ekle"
);

/** Buttons the bots send, mapped to the intent they represent. */
export const BUTTON_INTENTS = {
  order: "order",
  location: "location",
  menu: "menu",
  confirm_order: "confirm",
  modify_order: "modify",
  cancel: "cancel",
};

/**
 * @param {string} text  raw customer text
 * @param {{stage?: string}} [options]
 * @returns {string|null} one of cancel|status|menu|cart|clear|help|back|order|confirm|modify
 */
export function detectIntent(text, { stage = "idle" } = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (stage === "confirm") {
    if (CONFIRM_PHRASES.has(normalized)) return "confirm";
    if (MODIFY_PHRASES.has(normalized)) return "modify";
  }
  for (const [intent, phrases] of GLOBAL_INTENTS) {
    if (phrases.has(normalized)) return intent;
  }
  return null;
}

/** Order codes look like SIM-A3F9K2 (see orderCode.js). */
export function extractOrderCode(text) {
  const match = String(text ?? "").match(/\bSIM-[0-9A-F]{6}\b/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Every phrase that a built-in command owns. Admin keyword rules may not use
 * these (see orderKeywords.js), because the built-in command wins.
 */
export function reservedCommandPhrases() {
  const phrases = new Set();
  for (const [, set_] of GLOBAL_INTENTS) for (const phrase of set_) phrases.add(phrase);
  return phrases;
}

// ---------------------------------------------------------------------------
// Free-form questions -> admin keyword rules
// ---------------------------------------------------------------------------
//
// The admin defines rules like "location" and "hours" once, in English. These
// aliases let a customer asking "где вы находитесь?" or "saat kaça kadar
// açıksınız" reach the same rule. Each key is the keyword the admin rule must
// contain; if no such rule exists nothing happens.

const TOPIC_ALIASES = {
  location: [
    "location", "address", "where are you", "where are you located", "where is your cafe", "directions", "how to get there", "map",
    "адрес", "где вы", "где вы находитесь", "где находитесь", "как добраться", "локация", "карта", "как вас найти",
    "мекенжай", "қайдасыздар", "қайда орналасқансыздар", "қалай жетемін", "карта",
    "adres", "konum", "nerdesiniz", "nasıl gidilir", "harita",
  ],
  hours: [
    "hours", "opening hours", "working hours", "when do you open", "when do you close", "closing time", "are you open",
    "время работы", "часы работы", "режим работы", "график работы", "до скольки", "во сколько открываетесь", "вы работаете",
    "жұмыс уақыты", "қашан ашасыздар", "қашанға дейін жұмыс істейсіздер",
    "çalışma saatleri", "saat kaça kadar", "kaçta açılıyorsunuz", "açık mısınız",
  ],
  wifi: ["wifi", "wi fi", "wi-fi", "вайфай", "вай фай", "wifi şifresi"],
  phone: [
    "phone", "phone number", "contact", "call you",
    "телефон", "номер телефона", "контакты", "позвонить",
    "телефон нөмірі", "байланыс",
    "telefon", "telefon numarası", "iletişim",
  ],
};

const TOPIC_ALIAS_SETS = Object.entries(TOPIC_ALIASES).map(([keyword, aliases]) => [
  keyword,
  [...new Set(aliases.map(normalizeText))],
]);

/**
 * @param {string} text
 * @param {{exactOnly?: boolean}} [options] exactOnly: the whole message must
 *   equal an alias (used mid-order, where a substring match could swallow a name or item).
 * @returns {string|null} the admin keyword to look up
 */
export function detectTopic(text, { exactOnly = false } = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const padded = ` ${normalized} `;
  for (const [keyword, aliases] of TOPIC_ALIAS_SETS) {
    for (const alias of aliases) {
      if (exactOnly ? normalized === alias : padded.includes(` ${alias} `)) return keyword;
    }
  }
  return null;
}

// Words that mean "show me the menu/prices" when they appear inside a longer sentence.
const MENU_MENTIONS = [
  "menu", "prices", "price list", "how much", "цены", "прайс", "сколько стоит", "стоимость", "мәзір", "қанша тұрады", "бағалар",
  "menü", "fiyatlar", "ne kadar",
].map(normalizeText);

/** Outside the order flow: does this sentence mention the menu or prices? */
export function mentionsMenu(text) {
  const padded = ` ${normalizeText(text)} `;
  return MENU_MENTIONS.some((phrase) => padded.includes(` ${phrase} `));
}
