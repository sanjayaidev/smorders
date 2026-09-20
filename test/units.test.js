import "./helpers/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { detectIntent, detectTopic, extractOrderCode, normalizeText, reservedCommandPhrases, mentionsMenu } from "../src/lib/botIntents.js";
import { _STRINGS_FOR_TESTS, t, pickName, localizeWeightNote, SUPPORTED_LANGUAGES } from "../src/lib/botI18n.js";
import { splitMessage, formatMenuChunks } from "../src/lib/menuFormat.js";
import { matchItemsWithAI, applyCartChanges, formatCart } from "../src/lib/orderMatch.js";
import { statusChangeMessage, notifyCustomerOfStatusChange } from "../src/lib/customerNotify.js";
import { reservedOrderKeyword } from "../src/lib/orderKeywords.js";
import { detectMessageLanguage } from "../src/lib/messageLanguage.js";
import { CATEGORIES, PRODUCTS } from "./helpers/harness.js";

test("intents: whole-phrase, multilingual, punctuation/emoji/case-insensitive", () => {
  const cases = [
    ["Order!", "order"], ["заказ", "order"], ["Тапсырыс", "order"], ["SİPARİŞ", "order"],
    ["Меню 🍽", "menu"], ["мәзір", "menu"], ["MENÜ", "menu"],
    ["статус", "status"], ["күй", "status"], ["durum", "status"],
    ["Отмена", "cancel"], ["бас тарту", "cancel"], ["İptal", "cancel"],
    ["корзина", "cart"], ["sepet", "cart"], ["назад", "back"], ["yardım", "help"],
  ];
  for (const [text, expected] of cases) assert.equal(detectIntent(text), expected, text);
  assert.equal(detectIntent("2 simit and a menu"), null, "substrings are not commands");
  assert.equal(detectIntent("Status Quo"), null);
  assert.equal(detectIntent("yes"), null, "'yes' only means confirm on the summary screen");
  assert.equal(detectIntent("yes", { stage: "confirm" }), "confirm");
  assert.equal(detectIntent("да", { stage: "confirm" }), "confirm");
  assert.equal(detectIntent("нет", { stage: "confirm" }), "modify");
});

test("order codes and topics", () => {
  assert.equal(extractOrderCode("where is sim-a3f9k2?"), null); // K is not hex
  assert.equal(extractOrderCode("status of sim-a3f92b please"), "SIM-A3F92B");
  assert.equal(detectTopic("Подскажите адрес?"), "location");
  assert.equal(detectTopic("saat kaça kadar açıksınız"), "hours");
  assert.equal(detectTopic("Location Lane", { exactOnly: true }), null);
  assert.equal(detectTopic("location", { exactOnly: true }), "location");
  assert.equal(mentionsMenu("а какие у вас цены?"), true);
  assert.equal(mentionsMenu("hello"), false);
});

test("every language defines every string, with matching {placeholders}", () => {
  const keys = Object.keys(_STRINGS_FOR_TESTS.en);
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.deepEqual(Object.keys(_STRINGS_FOR_TESTS[lang]).sort(), [...keys].sort(), `${lang} keys`);
    for (const key of keys) {
      const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(placeholders(_STRINGS_FOR_TESTS[lang][key]), placeholders(_STRINGS_FOR_TESTS.en[key]), `${lang}.${key} placeholders`);
    }
  }
  // WhatsApp button titles are capped at 20 characters.
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const key of ["btnConfirm", "btnModify", "btnCancel"]) assert.ok([...t(lang, key)].length <= 20, `${lang}.${key} too long`);
  }
});

test("names, weights, splitting, menu formatting", () => {
  assert.equal(pickName({ en: "A", ru: "Б" }, "ru"), "Б");
  assert.equal(pickName({ en: "A" }, "kk"), "A");
  assert.equal(pickName(undefined, "ru"), "");
  assert.equal(localizeWeightNote("12 portions", "ru"), "12 порций");
  assert.equal(localizeWeightNote("300 g", "ru"), "300 г");
  assert.equal(localizeWeightNote("1 kg", "tr"), "1 kg");

  const long = Array.from({ length: 40 }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n");
  const chunks = splitMessage(long, 200);
  assert.ok(chunks.length > 5 && chunks.every((c) => c.length <= 200));
  assert.equal(chunks.join("\n").replace(/\s+/g, ""), long.replace(/\s+/g, ""), "nothing lost");
  assert.deepEqual(splitMessage("", 100), []);
  assert.equal(splitMessage("y".repeat(250), 100).length, 3, "hard-cuts a single over-long line");

  const cats = CATEGORIES.map((c) => ({ ...c, items: PRODUCTS.filter((p) => p.category_id === c.id && !p.coming_soon) })).filter((c) => c.items.length);
  const [ru] = formatMenuChunks(cats, "ru", { limit: 4000 });
  assert.match(ru, /^🍽 Наше меню/);
  assert.match(ru, /🥩 Мясные деликатесы\n• Кавурма \(томлёное мясо\) — 15000 KZT \(1 кг\)/);
});

test("matchItemsWithAI validates against the real menu and understands actions", async () => {
  const chat = async () => JSON.stringify({
    items: [
      { slug: "klasik-simit", quantity: 3, action: "set" },
      { slug: "made-up-item", quantity: 1, action: "add" },
      { slug: "fistikli-baklava", quantity: 500 },
      { slug: "kavurma", quantity: null, action: "remove" },
      { slug: "klasik-simit", quantity: 0, action: "set" },
    ],
    unmatchedText: "pizza",
  });
  const { items, unmatchedText } = await matchItemsWithAI("whatever", PRODUCTS, "ru", [], chat);
  assert.equal(items.length, 4, "hallucinated slug dropped");
  assert.deepEqual(items.map((i) => [i.slug, i.action, i.quantity]), [
    ["klasik-simit", "set", 3], ["fistikli-baklava", "add", 20], ["kavurma", "remove", null], ["klasik-simit", "remove", null],
  ]);
  assert.equal(items[0].price, 500, "price comes from the menu, not the model");
  assert.equal(items[0].names.ru, "Классический симит");
  assert.equal(unmatchedText, "pizza");

  await assert.rejects(matchItemsWithAI("x", PRODUCTS, "en", [], async () => "not json"));
});

test("applyCartChanges: add merges, set replaces, remove deletes or reduces; input not mutated", () => {
  const line = (slug, quantity, action, extra = {}) => ({ slug, quantity, action, name: slug, names: {}, price: 10, currency: "KZT", ...extra });
  const start = [{ slug: "a", quantity: 2, name: "a", names: {}, price: 10, currency: "KZT" }];
  const snapshot = JSON.stringify(start);
  let cart = applyCartChanges(start, [line("a", 1, "add"), line("b", 2, "add")]);
  assert.deepEqual(cart.map((c) => [c.slug, c.quantity]), [["a", 3], ["b", 2]]);
  assert.ok(!("action" in cart[0]) && !("action" in cart[1]));
  cart = applyCartChanges(cart, [line("a", 5, "set"), line("b", 1, "remove")]);
  assert.deepEqual(cart.map((c) => [c.slug, c.quantity]), [["a", 5], ["b", 1]]);
  cart = applyCartChanges(cart, [line("a", null, "remove"), line("zzz", null, "remove")]);
  assert.deepEqual(cart.map((c) => c.slug), ["b"]);
  assert.equal(JSON.stringify(start), snapshot);
  assert.equal(formatCart([{ ...start[0], names: { ru: "Эй" } }], "ru"), "2× Эй - 20 KZT");
  assert.equal(formatCart(start, "ru"), "2× a - 20 KZT", "old carts without names still render");
});

test("customer status notifications", async () => {
  const order = { channel: "whatsapp", customer_ref: "777", order_code: "SIM-ABCDEF", lang: "ru", status: "preparing" };
  assert.match(statusChangeMessage(order), /Ваш заказ SIM-ABCDEF уже готовится/);
  assert.match(statusChangeMessage({ ...order, status: "cancelled", lang: "tr", cancellation_reason: "Stok yok" }), /iptal edildi.*Stok yok/s);
  assert.equal(statusChangeMessage({ ...order, status: "on_queue" }), null);

  const calls = [];
  const senders = { whatsapp: async (to, text) => calls.push([to, text]) };
  assert.equal(await notifyCustomerOfStatusChange(order, senders), true);
  assert.deepEqual(calls[0][0], "777");
  assert.equal(await notifyCustomerOfStatusChange({ ...order, customer_ref: null }, senders), false, "website order");
  assert.equal(await notifyCustomerOfStatusChange({ ...order, channel: "web" }, senders), false);
  assert.equal(await notifyCustomerOfStatusChange(order, { whatsapp: async () => { throw new Error("24h window"); } }), false, "never throws");
  process.env.CUSTOMER_STATUS_NOTIFICATIONS = "off";
  assert.equal(await notifyCustomerOfStatusChange(order, senders), false);
  delete process.env.CUSTOMER_STATUS_NOTIFICATIONS;
});

test("reserved keywords cover built-ins in every language", () => {
  for (const word of ["меню", "Sepet", "бас тарту", "status", "hello?".replace("hello?", "help")]) assert.ok(reservedOrderKeyword(word), word);
  assert.equal(reservedOrderKeyword("hours"), null);
  assert.equal(reservedOrderKeyword("wifi"), null);
});

test("migrations: the SQL reserved-keyword list matches the JS one; Russian file covers every product", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20260915_bot_convenience.sql", import.meta.url), "utf8");
  const legacy = ["order", "confirm", "confirm_order", "place order", "cancel", "restart", "reset", "menu", "location", "price", "add / change", "modify_order"];
  for (const phrase of [...legacy, ...reservedCommandPhrases()]) {
    assert.ok(sql.includes(`'${phrase.replace(/'/g, "''")}'`), `SQL trigger is missing "${phrase}"`);
  }
  const ru = fs.readFileSync(new URL("../supabase/migrations/20260915_russian_menu_translations.sql", import.meta.url), "utf8");
  const slugs = [...ru.matchAll(/^\s+\('([^']+)', '/gm)].map((m) => m[1]);
  assert.equal(new Set(slugs).size, 28);
});

test("language detection: commands in Latin Turkish, Cyrillic, names", () => {
  assert.equal(detectMessageLanguage("sepet", "en"), "tr");
  assert.equal(detectMessageLanguage("Здравствуйте", "en"), "ru");
  assert.equal(detectMessageLanguage("12", "kk"), "kk");
  assert.equal(normalizeText("  İPTAL!! "), "iptal");
});
