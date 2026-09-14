export const ORDER_SYSTEM_KEYWORDS = new Set([
  "order", "confirm", "confirm_order", "place order", "cancel", "restart",
  "reset", "menu", "location", "price", "add / change", "modify_order",
]);

export function reservedOrderKeyword(keyword) {
  const normalized = String(keyword || "").trim().toLowerCase();
  return normalized && ORDER_SYSTEM_KEYWORDS.has(normalized) ? normalized : null;
}
