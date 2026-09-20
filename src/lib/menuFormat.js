import { supabase } from "../supabaseClient.js";
import { t, pickName, localizeWeightNote } from "./botI18n.js";

/**
 * Active categories with their orderable products, in display order.
 * "Coming soon" products are hidden: the bot can't take orders for them, and
 * listing something a customer then can't order is confusing.
 */
export async function getMenuForDisplay(db = supabase) {
  const { data: categories, error: catError } = await db
    .from("categories")
    .select("id, icon, sort_order, name")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (catError) throw catError;

  const { data: products, error: prodError } = await db
    .from("products")
    .select("id, category_id, emoji, price, currency, weight_note, sort_order, name")
    .eq("active", true)
    .eq("coming_soon", false)
    .order("sort_order", { ascending: true });
  if (prodError) throw prodError;

  return (categories || [])
    .map((category) => ({
      ...category,
      items: (products || []).filter((product) => product.category_id === category.id),
    }))
    .filter((category) => category.items.length > 0);
}

/** One category as text: a heading, then "• Name — price (weight)" per item. */
export function formatCategoryBlock(category, language) {
  const heading = `${category.icon ? `${category.icon} ` : ""}${pickName(category.name, language)}`.trim();
  const lines = category.items.map((item) => {
    const weight = item.weight_note ? ` (${localizeWeightNote(item.weight_note, language)})` : "";
    return `• ${pickName(item.name, language)} — ${item.price} ${item.currency}${weight}`;
  });
  return `${heading}\n${lines.join("\n")}`;
}

/**
 * Split text into pieces no longer than `limit`, preferring paragraph, then
 * line boundaries. Every messaging API caps message length (Instagram is the
 * strictest at ~1000 characters) and silently truncates or rejects longer
 * text, so long replies must be sent as several messages.
 */
export function splitMessage(text, limit) {
  const value = String(text ?? "").trim();
  if (!value) return [];
  if (value.length <= limit) return [value];

  const chunks = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of value.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    push();
    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }
    // A single paragraph longer than the limit: split it by lines, then by hard cut.
    for (const line of paragraph.split("\n")) {
      const lineCandidate = current ? `${current}\n${line}` : line;
      if (lineCandidate.length <= limit) {
        current = lineCandidate;
        continue;
      }
      push();
      let rest = line;
      while (rest.length > limit) {
        chunks.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      current = rest;
    }
  }
  push();
  return chunks;
}

/**
 * The menu as one or more messages, each within `limit` characters. Whole
 * categories are kept together where possible.
 *
 * @param {Array} categories result of getMenuForDisplay()
 * @param {string} language
 * @param {{limit: number, footer?: "idle"|"ordering"|"none"}} options
 *   footer: "idle" ends with 'send "order"', "ordering" with "just tell me what
 *   you'd like" (customer is already choosing items), "none" adds nothing.
 * @returns {string[]} empty when there is nothing to show
 */
export function formatMenuChunks(categories, language, { limit, footer = "idle" }) {
  if (!categories.length) return [];
  const footerKey = { idle: "menuFooterIdle", ordering: "menuFooterOrdering" }[footer];
  const parts = [t(language, "menuTitle"), ...categories.map((c) => formatCategoryBlock(c, language))];
  if (footerKey) parts.push(t(language, footerKey));
  return splitMessage(parts.join("\n\n"), limit);
}
