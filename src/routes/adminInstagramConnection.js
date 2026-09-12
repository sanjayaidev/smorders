import { Router } from "express";
import { supabase } from "../supabaseClient.js";
import { invalidateIgConnectionCache } from "../lib/igConnection.js";
import { subscribeInstagramWebhook } from "../lib/metaSubscriptions.js";

const router = Router();
const API_VERSION = process.env.INSTAGRAM_API_VERSION || process.env.WHATSAPP_API_VERSION || "v21.0";

function publicBaseUrl(req) {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (process.env.APP_BASE_URL || `${forwardedProto || req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function maskToken(token) {
  if (!token) return null;
  return token.length <= 8 ? "••••••••" : `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

/**
 * Pulls the @handle out of any reasonable way someone might paste an
 * Instagram profile: a full URL (with or without scheme/www), a bare
 * "instagram.com/handle", or just "@handle" / "handle" typed directly.
 */
function extractInstagramUsername(input) {
  if (!input) return null;
  let value = input.trim();
  value = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (value.toLowerCase().startsWith("instagram.com/")) {
    value = value.slice("instagram.com/".length);
  }
  value = value.split(/[/?#]/)[0]; // drop any trailing path/query
  value = value.replace(/^@/, "").trim();
  return value || null;
}

/**
 * GET /api/admin/instagram/connection
 * Returns the current connection with the access token masked.
 */
router.get("/", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("ig_connection").select("*").eq("id", 1).single();
    if (error) throw error;
    res.json({
      connection: {
        pageId: data.page_id,
        igUserId: data.ig_user_id,
        igUsername: data.ig_username,
        accessTokenMasked: maskToken(data.access_token),
        hasAccessToken: Boolean(data.access_token),
        appSecretSet: Boolean(data.app_secret),
        // Same env-only pattern as WhatsApp's verify token - not stored in
        // the DB, not returned here; see lib/igConnection.js.
        webhookUrl: `${publicBaseUrl(req)}/api/instagram/webhook`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/instagram/connection/lookup
 * body: { instagramUrl, accessToken }
 *
 * The admin pastes their Instagram profile URL (e.g. instagram.com/simit_astana)
 * and a Facebook Page access token. We list the Pages that token can manage,
 * find the one whose linked Instagram professional account matches that
 * handle, and return it - same "resolve, then confirm" shape as the WhatsApp
 * WABA lookup, just keyed by URL instead of a numeric WABA id.
 */
router.post("/lookup", async (req, res, next) => {
  try {
    const { instagramUrl, accessToken } = req.body || {};
    const username = extractInstagramUsername(instagramUrl);
    if (!username || !accessToken?.trim()) {
      return res.status(400).json({ error: "instagramUrl and accessToken are required." });
    }

    const url = `https://graph.facebook.com/${API_VERSION}/me/accounts?fields=id,name,instagram_business_account{id,username}`;
    const graphRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken.trim()}` } });
    const payload = await graphRes.json().catch(() => null);

    if (!graphRes.ok) {
      const message = payload?.error?.message || `Meta rejected that access token (${graphRes.status}).`;
      return res.status(400).json({ error: message });
    }

    const pagesWithInstagram = (payload?.data || []).filter((p) => p.instagram_business_account);
    if (pagesWithInstagram.length === 0) {
      return res.status(404).json({ error: "That token isn't linked to any Facebook Page with an Instagram professional account attached." });
    }

    const matches = pagesWithInstagram
      .filter((p) => p.instagram_business_account.username?.toLowerCase() === username.toLowerCase())
      .map((p) => ({
        pageId: p.id,
        pageName: p.name,
        igUserId: p.instagram_business_account.id,
        igUsername: p.instagram_business_account.username,
      }));

    if (matches.length === 0) {
      const available = pagesWithInstagram.map((p) => `@${p.instagram_business_account.username}`).join(", ");
      return res.status(404).json({
        error: `@${username} isn't among the Instagram accounts this token can manage${available ? ` (found: ${available})` : ""}.`,
      });
    }

    res.json({ accounts: matches });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/instagram/connection
 * body: { pageId, igUserId, igUsername, accessToken, appSecret? }
 *
 * Saves the chosen connection. Called after /lookup, once the admin has
 * confirmed the matched account.
 */
router.post("/", async (req, res, next) => {
  try {
    const { pageId, igUserId, igUsername, accessToken, appSecret } = req.body || {};
    if (!pageId?.trim() || !igUserId?.trim() || !accessToken?.trim()) {
      return res.status(400).json({ error: "pageId, igUserId and accessToken are required." });
    }

    const patch = {
      page_id: pageId.trim(),
      ig_user_id: igUserId.trim(),
      ig_username: igUsername?.trim() || null,
      access_token: accessToken.trim(),
      updated_at: new Date().toISOString(),
    };
    if (appSecret !== undefined) patch.app_secret = appSecret?.trim() || null;

    const { data, error } = await supabase.from("ig_connection").update(patch).eq("id", 1).select().single();
    if (error) throw error;

    invalidateIgConnectionCache();
    let webhookSubscription;
    try {
      webhookSubscription = await subscribeInstagramWebhook(data.ig_user_id, data.access_token, data.page_id);
    } catch (subscriptionError) {
      return res.status(502).json({
        error: `Instagram was saved, but Meta could not subscribe the account to webhooks: ${subscriptionError.message}`,
      });
    }

    res.json({
      webhookSubscription,
      connection: {
        pageId: data.page_id,
        igUserId: data.ig_user_id,
        igUsername: data.ig_username,
        accessTokenMasked: maskToken(data.access_token),
        hasAccessToken: Boolean(data.access_token),
        appSecretSet: Boolean(data.app_secret),
        webhookUrl: `${publicBaseUrl(req)}/api/instagram/webhook`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/instagram/connection/resubscribe
 * No body needed - re-runs the Meta webhook field subscription using
 * whatever's already saved in ig_connection (page_id, ig_user_id,
 * access_token). Useful for picking up a subscribed_fields change (like
 * adding messaging_postbacks) without having to re-paste a working access
 * token through /lookup + POST / when the one already saved is still valid.
 */
router.post("/resubscribe", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("ig_connection").select("*").eq("id", 1).single();
    if (error) throw error;
    if (!data?.access_token || (!data.page_id && !data.ig_user_id)) {
      return res.status(400).json({ error: "No Instagram connection is saved yet - use /lookup and save a connection first." });
    }

    const webhookSubscription = await subscribeInstagramWebhook(data.ig_user_id, data.access_token, data.page_id);
    res.json({ webhookSubscription });
  } catch (err) {
    // Surface Meta's rejection (e.g. the saved token turned out to be
    // invalid/expired after all) as a 502 rather than a generic 500.
    res.status(502).json({ error: err.message });
  }
});

export default router;
