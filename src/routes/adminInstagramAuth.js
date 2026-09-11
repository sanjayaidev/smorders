import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { supabase } from "../supabaseClient.js";
import { invalidateIgConnectionCache } from "../lib/igConnection.js";
import { subscribeInstagramWebhook } from "../lib/metaSubscriptions.js";

const router = Router();
const callbackRouter = Router();

function config() {
  return {
    appId: process.env.INSTAGRAM_APP_ID || process.env.IG_APP_ID || process.env.FACEBOOK_APP_ID,
    appSecret: process.env.INSTAGRAM_APP_SECRET || process.env.IG_SECRET || process.env.FACEBOOK_APP_SECRET,
  };
}

function sign(value) {
  const secret = process.env.ADMIN_PASS || "";
  return createHmac("sha256", secret).update(value).digest("hex");
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

function errorRedirect(returnUrl, reason) {
  const safeReason = String(reason || "Instagram OAuth failed").slice(0, 180);
  return `${returnUrl}?instagramAuth=error&reason=${encodeURIComponent(safeReason)}`;
}

router.get("/auth-url", (req, res) => {
  const { appId } = config();
  if (!appId || !config().appSecret) {
    return res.status(500).json({ error: "Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to enable Instagram login." });
  }

  const redirectUri = `${baseUrl(req)}/api/auth/instagram/callback`;
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state: makeState(redirectUri),
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_manage_messages",
  });
  res.json({ url: `https://www.instagram.com/oauth/authorize?${params}` });
});

callbackRouter.get("/callback", async (req, res) => {
  let state;
  try {
    state = readState(req.query.state);
  } catch {
    state = null;
  }
  const returnUrl = "/admin/instagram.html";
  if (!state) return res.redirect(`${returnUrl}?instagramAuth=invalid_state`);
  if (req.query.error || !req.query.code) return res.redirect(`${returnUrl}?instagramAuth=cancelled`);

  try {
    const { appId, appSecret } = config();
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: state.redirectUri,
      code: req.query.code,
    });
    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams,
    });
    const tokenPayload = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenPayload?.access_token) throw new Error(errorMessage(tokenPayload, "Meta token exchange failed."));

    const longLivedParams = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: tokenPayload.access_token,
    });
    const longLivedRes = await fetch(`https://graph.instagram.com/access_token?${longLivedParams}`);
    const longLivedPayload = await longLivedRes.json().catch(() => null);
    if (!longLivedRes.ok || !longLivedPayload?.access_token) {
      throw new Error(errorMessage(longLivedPayload, "Instagram long-lived token exchange failed."));
    }

    const profileRes = await fetch("https://graph.instagram.com/me?fields=id,user_id,username", {
      headers: { Authorization: `Bearer ${longLivedPayload.access_token}` },
    });
    const profile = await profileRes.json().catch(() => null);
    const igUserId = profile?.user_id || profile?.id;
    if (!profileRes.ok || !igUserId) throw new Error(errorMessage(profile, "Instagram business profile lookup failed."));

    const { error } = await supabase.from("ig_connection").update({
      page_id: null,
      ig_user_id: igUserId,
      ig_username: profile.username || null,
      access_token: longLivedPayload.access_token,
      app_secret: appSecret,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) throw error;
    invalidateIgConnectionCache();
    try {
      await subscribeInstagramWebhook(igUserId, longLivedPayload.access_token);
      res.redirect(`${returnUrl}?instagramAuth=connected&instagramWebhook=connected`);
    } catch (subscriptionError) {
      console.error("Instagram webhook subscription failed after OAuth login:", subscriptionError.message);
      res.redirect(`${returnUrl}?instagramAuth=connected&instagramWebhook=error`);
    }
  } catch (err) {
    console.error("Instagram OAuth callback failed:", err.message);
    res.redirect(errorRedirect(returnUrl, err.message));
  }
});

export { callbackRouter as instagramAuthCallbackRouter };
export default router;