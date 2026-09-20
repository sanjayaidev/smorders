import { callDashScopeChat } from "./dashscope.js";
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, normalizeLanguage } from "./botI18n.js";

export { SUPPORTED_LANGUAGES };

/** Detect the customer's language without replacing the original message. */
export function detectMessageLanguage(text, previousLanguage = "en") {
  // "İ".toLowerCase() leaves a combining dot behind, which would break \b matches.
  const value = String(text || "").trim().toLowerCase().replace(/\u0307/g, "");
  if (!value) return normalizeLanguage(previousLanguage);
  if (/[әғқңөұүіһ]/u.test(value)) return "kk";
  if (/[çğıöşü]/u.test(value)) return "tr";
  if (/[а-яё]/u.test(value)) return "ru";
  if (/\b(merhaba|selam|sipariş|siparis|masa|teşekkür|istiyorum|lütfen|menü|sepet|iptal|durum|geri|fiyat)\b/u.test(value)) return "tr";
  if (/\b(сәлем|тапсырыс|үстел|рахмет|қалай|керек)\b/u.test(value)) return "kk";
  if (/\b(здравствуйте|заказ|стол|спасибо|хочу|пожалуйста|меню)\b/u.test(value)) return "ru";
  if (/\b(the|and|order|table|please|want|hello|menu)\b/u.test(value)) return "en";
  return normalizeLanguage(previousLanguage);
}

// Admin-written text (welcome message, keyword replies, follow-up nudge,
// button labels) is translated with the AI. The same handful of strings is
// sent over and over, so remember successful translations instead of paying
// for - and waiting on - an API call every time. Failures are never cached.
const CACHE_LIMIT = 500;
const translationCache = new Map();

/** Localize admin-configured messages for non-website channels. */
export async function localizeMessage(text, language) {
  if (!text || language === "en") return text;
  const cacheKey = `${language}\u0000${text}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

  const target = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.en;
  const messages = [
    {
      role: "system",
      content: `Translate the message below into ${target}. Preserve meaning, emojis, names, numbers, order codes, menu item names, line breaks, and quotation marks. Return ONLY JSON: {"text":"..."}. Do not add explanations.`,
    },
    { role: "user", content: String(text).slice(0, 4000) },
  ];
  try {
    const raw = await callDashScopeChat(messages);
    const parsed = JSON.parse(raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim());
    if (typeof parsed.text === "string" && parsed.text.trim()) {
      const translated = parsed.text.trim();
      if (translationCache.size >= CACHE_LIMIT) translationCache.delete(translationCache.keys().next().value);
      translationCache.set(cacheKey, translated);
      return translated;
    }
    return text;
  } catch (error) {
    console.error("localizeMessage failed:", error.message);
    return text;
  }
}
