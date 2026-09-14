import { supabase } from "../supabaseClient.js";

let cache = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 30_000;

export async function getFbConnection() {
  if (cache && Date.now() < cacheExpiresAt) return cache;
  const { data, error } = await supabase.from("fb_connection").select("*").eq("id", 1).maybeSingle();
  if (error) console.error("getFbConnection query failed:", error.message);
  cache = {
    pageId: data?.page_id || process.env.FACEBOOK_PAGE_ID || null,
    pageName: data?.page_name || null,
    accessToken: data?.access_token || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || null,
    appSecret: data?.app_secret || process.env.FACEBOOK_APP_SECRET || null,
    verifyToken: process.env.FACEBOOK_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || null,
  };
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cache;
}

export function invalidateFbConnectionCache() {
  cache = null;
  cacheExpiresAt = 0;
}
