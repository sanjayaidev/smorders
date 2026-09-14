import { callDashScopeChat } from "./dashscope.js";

export const SUPPORTED_LANGUAGES = ["en", "tr", "kk", "ru"];

const LANGUAGE_NAMES = { en: "English", tr: "Turkish", kk: "Kazakh", ru: "Russian" };

/** Detect the customer's language without replacing the original message. */
export function detectMessageLanguage(text, previousLanguage = "en") {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return SUPPORTED_LANGUAGES.includes(previousLanguage) ? previousLanguage : "en";
  if (/[әғқңөұүіһ]/u.test(value)) return "kk";
  if (/[çğıöşü]/u.test(value)) return "tr";
  if (/[а-яё]/u.test(value)) return "ru";
  if (/\b(merhaba|selam|sipariş|masa|teşekkür|istiyorum|lütfen|menü)\b/u.test(value)) return "tr";
  if (/\b(сәлем|тапсырыс|үстел|рахмет|қалай|керек)\b/u.test(value)) return "kk";
  if (/\b(здравствуйте|заказ|стол|спасибо|хочу|пожалуйста|меню)\b/u.test(value)) return "ru";
  if (/\b(the|and|order|table|please|want|hello|menu)\b/u.test(value)) return "en";
  return SUPPORTED_LANGUAGES.includes(previousLanguage) ? previousLanguage : "en";
}

/** Localize fixed and admin-configured messages for non-website channels. */
export async function localizeMessage(text, language) {
  if (!text || language === "en") return text;
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
    return typeof parsed.text === "string" && parsed.text.trim() ? parsed.text.trim() : text;
  } catch (error) {
    console.error("localizeMessage failed:", error.message);
    return text;
  }
}
