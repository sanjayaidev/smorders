import { supabase } from "../supabaseClient.js";

let cache = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Returns { wabaId, accessToken, appSecret, phoneNumberId, phoneNumberDisplay, verifyToken }.
 * DB values (set via the admin "Connection" panel) win; falls back to
 * environment variables for anyone who'd rather configure it that way.
 * Cached briefly since every inbound message reads this at least once.
 */
export async function getWaConnection() {
  if (cache && Date.now() < cacheExpiresAt) return cache;

  const { data, error } = await supabase.from("wa_connection").select("*").eq("id", 1).maybeSingle();
  if (error) console.error("getWaConnection query failed:", error.message);

  cache = {
    wabaId: data?.waba_id || process.env.WHATSAPP_WABA_ID || null,
    accessToken: data?.access_token || process.env.WHATSAPP_TOKEN || null,
    appSecret: data?.app_secret || process.env.WHATSAPP_APP_SECRET || null,
    phoneNumberId: data?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    phoneNumberDisplay: data?.phone_number_display || null,
    verifyToken: data?.verify_token || process.env.WHATSAPP_VERIFY_TOKEN || null,
  };
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cache;
}

/** Called right after the admin saves a new connection, so the next message doesn't wait out the TTL. */
export function invalidateWaConnectionCache() {
  cache = null;
  cacheExpiresAt = 0;
}
