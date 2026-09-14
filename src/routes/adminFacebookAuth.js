import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { supabase } from "../supabaseClient.js";
import { invalidateFbConnectionCache } from "../lib/fbConnection.js";
import { subscribeFacebookWebhook } from "../lib/metaSubscriptions.js";

const router = Router();
const callbackRouter = Router();
const API_VERSION = process.env.FACEBOOK_API_VERSION || process.env.WHATSAPP_API_VERSION || "v21.0";

function config() {
  return { appId: process.env.FACEBOOK_APP_ID, appSecret: process.env.FACEBOOK_APP_SECRET };
}

function sign(value) {
  return createHmac("sha256", process.env.ADMIN_PASS || "").update(value).digest("hex");
}

function makeState(redirectUri) {
  const value = Buffer.from(JSON.stringify({ redirectUri, issuedAt: Date.now() })).toString("base64url");
  return `${value}.${sign(value)}`;
}

function readState(state) {
  const [value, provided] = String(state || "").split(".");
  if (!value || !provided) return null;
  const expected = sign(value);
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  return Date.now() - data.issuedAt < 10 * 60 * 1000 ? data : null;
}

function baseUrl(req) {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (process.env.APP_BASE_URL || `${forwardedProto || req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function errorMessage(payload, fallback) {
  return payload?.error?.message || payload?.error_message || payload?.message || fallback;
}

function redirect(returnUrl, params) {
  return `${returnUrl}?${new URLSearchParams(params)}`;
}

router.get("/auth-url", (req, res) => {
  const { appId, appSecret } = config();
  if (!appId || !appSecret) {
    return res.status(500).json({ error: "Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to enable Facebook Login." });
  }
  const redirectUri = `${baseUrl(req)}/api/auth/facebook/callback`;
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state: makeState(redirectUri),
    response_type: "code",
    scope: "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging",
  });
  res.json({ url: `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params}` });
});

callbackRouter.get("/callback", async (req, res) => {
  const returnUrl = "/admin/facebook.html";
  let state;
  try { state = readState(req.query.state); } catch { state = null; }
  if (!state) return res.redirect(redirect(returnUrl, { facebookAuth: "invalid_state" }));
  if (req.query.error || !req.query.code) return res.redirect(redirect(returnUrl, { facebookAuth: "cancelled" }));

  try {
    const { appId, appSecret } = config();
    const tokenParams = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: state.redirectUri, code: req.query.code });
    const tokenRes = await fetch(`https://graph.facebook.com/${API_VERSION}/oauth/access_token?${tokenParams}`);
    const tokenPayload = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenPayload?.access_token) throw new Error(errorMessage(tokenPayload, "Meta token exchange failed."));

    const pagesRes = await fetch(`https://graph.facebook.com/${API_VERSION}/me/accounts?fields=id,name,access_token`, {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const pagesPayload = await pagesRes.json().catch(() => null);
    if (!pagesRes.ok) throw new Error(errorMessage(pagesPayload, "Meta Page lookup failed."));
    const page = (pagesPayload?.data || []).find((item) => item.id && item.access_token);
    if (!page) throw new Error("This Facebook account does not manage a Page with a Page access token.");

    const { data, error } = await supabase.from("fb_connection").update({
      page_id: page.id,
      page_name: page.name || null,
      access_token: page.access_token,
      app_secret: appSecret,
      updated_at: new Date().toISOString(),
    }).eq("id", 1).select().single();
    if (error) throw error;
    invalidateFbConnectionCache();

    try {
      await subscribeFacebookWebhook(data.page_id, data.access_token);
      res.redirect(redirect(returnUrl, { facebookAuth: "connected" }));
    } catch (subscriptionError) {
      console.error("Facebook webhook subscription failed after OAuth login:", subscriptionError.message);
      res.redirect(redirect(returnUrl, { facebookAuth: "connected", facebookWebhook: "error" }));
    }
  } catch (error) {
    console.error("Facebook OAuth callback failed:", error.message);
    res.redirect(redirect(returnUrl, { facebookAuth: "error", reason: String(error.message).slice(0, 180) }));
  }
});

export { callbackRouter as facebookAuthCallbackRouter };
export default router;
