import { normalizeText, reservedCommandPhrases } from "./botIntents.js";

// Button ids and legacy commands the order system has always owned.
const LEGACY_RESERVED = [
  "order", "confirm", "confirm_order", "place order", "cancel", "restart",
  "reset", "menu", "location", "price", "add / change", "modify_order",
];

/**
 * Everything an admin keyword rule may NOT use, because a built-in command
 * (in any of the four languages) handles it first. The Postgres trigger
 * `reject_order_system_keyword` mirrors this list - test/migrations.test.js
 * fails if the two drift apart.
 */
export const ORDER_SYSTEM_KEYWORDS = new Set([
  ...LEGACY_RESERVED,
  ...LEGACY_RESERVED.map(normalizeText),
  ...reservedCommandPhrases(),
]);

export function reservedOrderKeyword(keyword) {
  const raw = String(keyword || "").trim().toLowerCase();
  if (!raw) return null;
  if (ORDER_SYSTEM_KEYWORDS.has(raw)) return raw;
  const normalized = normalizeText(raw);
  return normalized && ORDER_SYSTEM_KEYWORDS.has(normalized) ? normalized : null;
}
