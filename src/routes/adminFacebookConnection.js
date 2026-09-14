import { Router } from "express";
import { supabase } from "../supabaseClient.js";
import { invalidateFbConnectionCache } from "../lib/fbConnection.js";
import { subscribeFacebookWebhook } from "../lib/metaSubscriptions.js";

const router = Router();
const API_VERSION = process.env.FACEBOOK_API_VERSION || process.env.WHATSAPP_API_VERSION || "v21.0";
const baseUrl = (req) => (process.env.APP_BASE_URL || `${req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol}://${req.get("host")}`).replace(/\/$/, "");
const mask = (token) => !token ? null : token.length <= 8 ? "••••••••" : `${token.slice(0, 4)}••••${token.slice(-4)}`;

function publicConnection(req, data) {
  return { pageId: data.page_id, pageName: data.page_name, accessTokenMasked: mask(data.access_token), hasAccessToken: Boolean(data.access_token), appSecretSet: Boolean(data.app_secret), webhookUrl: `${baseUrl(req)}/api/facebook/webhook` };
}
router.get("/", async (req, res, next) => {
  try { const result = await supabase.from("fb_connection").select("*").eq("id", 1).single(); if (result.error) throw result.error; res.json({ connection: publicConnection(req, result.data) }); } catch (error) { next(error); }
});
router.post("/lookup", async (req, res, next) => {
  try {
    const { accessToken } = req.body || {};
    if (!accessToken?.trim()) return res.status(400).json({ error: "accessToken is required." });
    const response = await fetch(`https://graph.facebook.com/${API_VERSION}/me/accounts?fields=id,name,access_token`, { headers: { Authorization: `Bearer ${accessToken.trim()}` } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return res.status(400).json({ error: payload?.error?.message || `Meta rejected that access token (${response.status}).` });
    const pages = (payload?.data || []).map((page) => ({ pageId: page.id, pageName: page.name, pageAccessToken: page.access_token || null })).filter((page) => page.pageId && page.pageAccessToken);
    if (!pages.length) return res.status(404).json({ error: "That token does not manage any Facebook Pages, or it did not return Page access tokens." });
    res.json({ pages });
  } catch (error) { next(error); }
});
router.post("/", async (req, res, next) => {
  try {
    const { pageId, pageName, accessToken, appSecret } = req.body || {};
    if (!pageId?.trim() || !accessToken?.trim()) return res.status(400).json({ error: "pageId and accessToken are required." });
    const patch = { page_id: pageId.trim(), page_name: pageName?.trim() || null, access_token: accessToken.trim(), updated_at: new Date().toISOString() };
    if (appSecret !== undefined) patch.app_secret = appSecret?.trim() || null;
    const result = await supabase.from("fb_connection").update(patch).eq("id", 1).select().single();
    if (result.error) throw result.error;
    invalidateFbConnectionCache();
    let webhookSubscription;
    try { webhookSubscription = await subscribeFacebookWebhook(result.data.page_id, result.data.access_token); }
    catch (error) { return res.status(502).json({ error: `Facebook Page was saved, but Meta could not subscribe it to webhooks: ${error.message}` }); }
    res.json({ webhookSubscription, connection: publicConnection(req, result.data) });
  } catch (error) { next(error); }
});
router.post("/resubscribe", async (req, res) => {
  const result = await supabase.from("fb_connection").select("*").eq("id", 1).single();
  if (result.error) return res.status(500).json({ error: result.error.message });
  if (!result.data?.page_id || !result.data?.access_token) return res.status(400).json({ error: "No Facebook Page connection is saved yet." });
  try { res.json({ webhookSubscription: await subscribeFacebookWebhook(result.data.page_id, result.data.access_token) }); }
  catch (error) { res.status(502).json({ error: error.message }); }
});
export default router;
