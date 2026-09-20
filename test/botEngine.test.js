import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, simpleMatcher } from "./helpers/harness.js";

const USER = "77001234567";

async function orderInRussian(h) {
  await h.say(USER, "Здравствуйте"); // welcome + AI fallback
  await h.say(USER, "заказ");
  await h.say(USER, "Айгерим");
  return h.say(USER, "5");
}

test("Russian customer: ordering shows the menu with Russian names, then the whole flow works", async () => {
  const h = await makeHarness({ matchItems: simpleMatcher() });

  const start = await h.say(USER, "Здравствуйте");
  assert.ok(start.some((m) => m.buttons), "welcome buttons sent");

  const afterOrder = await h.say(USER, "заказ");
  assert.match(h.texts(afterOrder), /На какое имя/);

  const afterName = await h.say(USER, "Айгерим");
  assert.match(h.texts(afterName), /Спасибо, Айгерим/);

  // THE BUG: after the table number the customer must be able to SEE the menu.
  const afterTable = await h.say(USER, "5");
  const shown = h.texts(afterTable);
  assert.match(shown, /Наше меню/);
  assert.match(shown, /Классический симит — 500 KZT/);
  assert.match(shown, /Баклава с фисташками — 9000 KZT \(1 кг\)/); // localized name AND unit
  assert.doesNotMatch(shown, /Classic Simit/, "no English names for a Russian customer");
  assert.doesNotMatch(shown, /Nutella/, "coming-soon items are hidden");
  assert.match(afterTable.at(-1).text, /Что бы вы хотели заказать/); // prompt comes after the menu

  const afterItems = await h.say(USER, "2 симита");
  const summary = afterItems.find((m) => /Итого/.test(m.text));
  assert.match(summary.text, /2× Классический симит - 1000 KZT/);
  assert.match(summary.text, /Итого: 1000 KZT/);
  const buttons = afterItems.at(-1).buttons.map((b) => b.id);
  assert.deepEqual(buttons, ["confirm_order", "modify_order", "cancel"]);

  const placed = await h.tap(USER, "confirm_order", "✅ Подтвердить");
  assert.match(h.texts(placed), /Заказ принят! Номер вашего заказа: SIM-[0-9A-F]{6}/);

  const [order] = h.db.rowsOf("orders");
  assert.equal(order.channel, "whatsapp");
  assert.equal(order.lang, "ru");
  assert.equal(order.customer_ref, USER);
  assert.equal(order.total, 1000);
  const [item] = h.db.rowsOf("order_items");
  assert.equal(item.product_name, "Классический симит", "order line stored in the customer's language");

  const owner = h.sent.find((m) => m.to === "owner-1");
  assert.match(owner.text, /New order SIM-/);
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "idle");
});

test("Menu button and typed 'menu' show the live menu (no more circular keyword reply)", async () => {
  const h = await makeHarness({ keywords: [{ keyword: "price", response: "You can see our full menu and prices any time" }] });
  await h.say(USER, "hello");
  const viaButton = await h.tap(USER, "menu", "💰 Menu & prices");
  assert.match(h.texts(viaButton), /Classic Simit — 500 KZT/);
  assert.doesNotMatch(h.texts(viaButton), /any time/);

  for (const word of ["menu", "МЕНЮ!", "мәзір", "Menü"]) {
    const reply = await h.say(USER, word);
    assert.match(h.texts(reply), /—\s*500 KZT/, `"${word}" shows the menu`);
  }
  const sentence = await h.say(USER, "сколько стоит баклава?");
  assert.match(h.texts(sentence), /500 KZT/, "a sentence asking about prices shows the menu");
});

test("menu typed in the middle of an order does not lose the customer's place", async () => {
  const h = await makeHarness({ matchItems: simpleMatcher() });
  await h.say(USER, "order");
  await h.say(USER, "order");
  const midName = await h.say(USER, "menu");
  assert.match(h.texts(midName), /Classic Simit/);
  assert.match(midName.at(-1).text, /name should I put/i, "re-asks the current question");
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "ask_name");
});

test("multilingual reset: 'отмена' clears the draft; 'cancel' with nothing to cancel is honest", async () => {
  const h = await makeHarness();
  await h.say(USER, "hi");
  await h.say(USER, "order");
  await h.say(USER, "Bob");
  const cancelled = await h.say(USER, "отмена");
  assert.match(h.texts(cancelled), /Без проблем/);
  const convo = h.db.rowsOf("t_conversations")[0];
  assert.equal(convo.stage, "idle");
  assert.equal(convo.customer_name, null);

  // Language is sticky per conversation, so the reply stays Russian here...
  const again = await h.say(USER, "cancel");
  assert.match(h.texts(again), /нечего отменять/);
  // ...while a new English customer with nothing in progress gets the English wording.
  const fresh = await h.say("55555", "cancel");
  assert.match(h.texts(fresh), /nothing to cancel/i);
});

test("back steps through the flow", async () => {
  const h = await makeHarness();
  await h.say(USER, "hi");
  await h.say(USER, "order");
  await h.say(USER, "Bob");
  await h.say(USER, "3"); // now ask_items
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "ask_items");
  await h.say(USER, "back");
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "ask_table");
  await h.say(USER, "back");
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "ask_name");
});

test("confirm-stage edits: free text 'remove' and 'make it 3', and the Cancel button", async () => {
  const h = await makeHarness({ matchItems: simpleMatcher() });
  await h.say(USER, "hi");
  await h.say(USER, "order");
  await h.say(USER, "Bob");
  await h.say(USER, "3");
  await h.say(USER, "2 simit");

  const three = await h.say(USER, "make it 3");
  assert.match(h.texts(three), /3× Classic Simit - 1500 KZT/);

  const removed = await h.say(USER, "remove the simit");
  assert.match(h.texts(removed), /cart's empty/);
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "ask_items");

  await h.say(USER, "2 simit");
  await h.tap(USER, "cancel", "❌ Cancel");
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "idle");
  assert.equal(h.db.rowsOf("orders").length, 0);
});

test("unmatched text is reported, and gibberish does not create a cart", async () => {
  const h = await makeHarness({ matchItems: simpleMatcher() });
  await h.say(USER, "hi");
  await h.say(USER, "order");
  await h.say(USER, "Bob");
  await h.say(USER, "3");
  const nothing = await h.say(USER, "asdf");
  assert.match(h.texts(nothing), /couldn't match/);
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "ask_items");
  const partial = await h.say(USER, "2 simit and a pizza");
  assert.match(h.texts(partial), /couldn't match "pizza"/);
});

test("order status: own latest order, by code, and 'none found'", async () => {
  const h = await makeHarness({ matchItems: simpleMatcher() });
  const empty = await h.say(USER, "status");
  assert.match(h.texts(empty), /couldn't find a recent order/);

  await h.say(USER, "order");
  await h.say(USER, "Bob");
  await h.say(USER, "3");
  await h.say(USER, "2 simit");
  await h.tap(USER, "confirm_order");
  const code = h.db.rowsOf("orders")[0].order_code;

  const mine = await h.say(USER, "status");
  assert.match(h.texts(mine), new RegExp(`Order ${code}`));
  assert.match(h.texts(mine), /In the queue/);
  assert.match(h.texts(mine), /2× Classic Simit/);

  h.db.rowsOf("orders")[0].status = "preparing";
  const ru = await h.say(USER, "где мой заказ");
  assert.match(h.texts(ru), /Готовится/);

  // Another customer can look an order up by its code, but "status" alone finds nothing for them.
  const other = await h.say("99999", `where is ${code}?`);
  assert.match(h.texts(other), new RegExp(code));
  const otherStatus = await h.say("99999", "status");
  assert.match(h.texts(otherStatus), /couldn't find a recent order/);

  const bad = await h.say(USER, "SIM-000000");
  assert.match(h.texts(bad), /SIM-000000 не найден/); // this customer's conversation is Russian by now
});

test("a duplicate 'Confirm' delivery does not create a second order", async () => {
  const h = await makeHarness({ matchItems: simpleMatcher() });
  await h.say(USER, "order");
  await h.say(USER, "Bob");
  await h.say(USER, "3");
  await h.say(USER, "2 simit");
  await Promise.all([h.tap(USER, "confirm_order"), h.tap(USER, "confirm_order")]);
  assert.equal(h.db.rowsOf("orders").length, 1);
});

test("orders still work if the customer_ref migration has not been run", async () => {
  const h = await makeHarness({ matchItems: simpleMatcher(), dbOptions: { rejectColumns: { orders: ["customer_ref"] } } });
  await h.say(USER, "order");
  await h.say(USER, "Bob");
  await h.say(USER, "3");
  await h.say(USER, "2 simit");
  const placed = await h.tap(USER, "confirm_order");
  assert.match(h.texts(placed), /Order placed/);
  assert.equal(h.db.rowsOf("orders").length, 1);
  assert.equal("customer_ref" in h.db.rowsOf("orders")[0], false);
});

test("a stale draft expires instead of swallowing tomorrow's message", async () => {
  let clock = new Date("2026-09-20T12:00:00Z");
  const h = await makeHarness({ now: () => clock, matchItems: simpleMatcher() });
  await h.say(USER, "order");
  await h.say(USER, "Bob");
  await h.say(USER, "3");
  await h.say(USER, "2 simit");
  clock = new Date("2026-09-20T20:30:00Z"); // 8+ hours later
  const later = await h.say(USER, "menu");
  assert.match(h.texts(later), /timed out/);
  assert.match(h.texts(later), /Classic Simit/);
  const convo = h.db.rowsOf("t_conversations")[0];
  assert.equal(convo.stage, "idle");
  assert.deepEqual(convo.cart, []);
});

test("keyword rules: multilingual aliases reach the admin's location reply; mid-order only exact words do", async () => {
  const h = await makeHarness({ keywords: [{ keyword: "location", response: "We are at Main St" }] });
  await h.say(USER, "hi");
  const ru = await h.say(USER, "подскажите адрес");
  assert.match(h.texts(ru), /\[ru\] We are at Main St/);
  const btn = await h.tap(USER, "location", "📍 Location");
  assert.match(h.texts(btn), /We are at Main St/);

  await h.say(USER, "order");
  const midOrderName = await h.say(USER, "Location Lane Cafe"); // a name that merely contains the word
  assert.match(h.texts(midOrderName), /Thanks, Location Lane Cafe/);
});

test("a stale button never becomes someone's name; over-long names are rejected", async () => {
  const h = await makeHarness();
  await h.say(USER, "order");
  await h.tap(USER, "location", "📍 Location"); // no location keyword configured
  assert.ok(!h.db.rowsOf("t_conversations")[0].customer_name, "the button label was not stored as a name");
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "ask_name");
  const long = await h.say(USER, "x".repeat(60));
  assert.match(h.texts(long), /a bit long/);
  assert.equal(h.db.rowsOf("t_conversations")[0].stage, "ask_name");
});

test("language: a Turkish name doesn't flip the language mid-order, buttons keep it", async () => {
  const h = await makeHarness();
  await h.say(USER, "Здравствуйте");
  await h.say(USER, "заказ");
  await h.say(USER, "Çağla");
  assert.equal(h.db.rowsOf("t_conversations")[0].language, "ru");
  await h.tap(USER, "menu", "Menu");
  assert.equal(h.db.rowsOf("t_conversations")[0].language, "ru");
});

test("Instagram-style channel: short limit splits the menu; commands skip the welcome", async () => {
  const h = await makeHarness({ config: { textLimit: 120, welcomeEndsTurn: true } });
  const first = await h.say(USER, "menu"); // first message of the day is a command
  assert.ok(first.length > 1, "menu split into several messages");
  assert.ok(first.every((m) => m.text.length <= 120));
  assert.ok(!first.some((m) => m.buttons), "no welcome buttons, the customer got what they asked for");

  const greeter = await h.say("other-user", "hello");
  assert.ok(greeter.some((m) => m.buttons), "plain greeting still gets the welcome");
  assert.equal(greeter.filter((m) => !m.buttons).length, 1, "and the turn ends there");
});

test("follow-up nudge goes to quiet mid-order conversations only, once", async () => {
  let clock = new Date("2026-09-20T12:00:00Z");
  const h = await makeHarness({ now: () => clock });
  await h.say(USER, "order"); // ask_name
  await h.say("idle-user", "hi"); // stays idle
  clock = new Date("2026-09-20T12:20:00Z");
  const before = h.sent.length;
  await h.engine.sendPendingFollowups();
  const nudges = h.sent.slice(before);
  assert.equal(nudges.length, 1);
  assert.equal(nudges[0].to, USER);
  await h.engine.sendPendingFollowups();
  assert.equal(h.sent.length, before + 1, "not repeated");
});
