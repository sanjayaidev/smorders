import { supabase } from "../supabaseClient.js";

let cache = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Returns { pageId, igUserId, igUsername, accessToken, appSecret, verifyToken }.
 * DB values (set via the admin "Connection" panel) win for everything except
 * the webhook verify token, which is always read from
 * INSTAGRAM_VERIFY_TOKEN (falling back to the shared META_VERIFY_TOKEN, in
 * case one Meta app is used for both WhatsApp and Instagram) - never stored
 * in the DB or shown in the admin UI. Cached briefly since every inbound
 * message reads this at least once.
 */
export async function getIgConnection() {
  if (cache && Date.now() < cacheExpiresAt) return cache;

  const { data, error } = await supabase.from("ig_connection").select("*").eq("id", 1).maybeSingle();
  if (error) console.error("getIgConnection query failed:", error.message);

  cache = {
    pageId: data?.page_id || process.env.INSTAGRAM_PAGE_ID || null,
    igUserId: data?.ig_user_id || process.env.INSTAGRAM_USER_ID || null,
    igUsername: data?.ig_username || null,
    accessToken: data?.access_token || process.env.INSTAGRAM_TOKEN || null,
    appSecret: data?.app_secret || process.env.INSTAGRAM_APP_SECRET || null,
    verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || null,
  };
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cache;
}

/** Called right after the admin saves a new connection, so the next message doesn't wait out the TTL. */
export function invalidateIgConnectionCache() {
  cache = null;
  cacheExpiresAt = 0;
}
