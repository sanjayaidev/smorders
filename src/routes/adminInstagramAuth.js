import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { supabase } from "../supabaseClient.js";
import { invalidateIgConnectionCache } from "../lib/igConnection.js";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";
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
  return (process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
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
    scope: "pages_show_list,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages",
  });
  res.json({ url: `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params}` });
});

callbackRouter.get("/callback", async (req, res) => {
  const state = readState(req.query.state);
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
    const tokenRes = await fetch(`https://graph.facebook.com/${API_VERSION}/oauth/access_token?${tokenParams}`);
    const tokenPayload = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenPayload?.access_token) throw new Error(tokenPayload?.error?.message || "Meta token exchange failed.");

    const accountsRes = await fetch(`https://graph.facebook.com/${API_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`, {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const accountsPayload = await accountsRes.json().catch(() => null);
    const account = (accountsPayload?.data || []).find((item) => item.instagram_business_account);
    if (!accountsRes.ok || !account) throw new Error("No Facebook Page with a linked Instagram professional account was found.");

    const pageToken = account.access_token || tokenPayload.access_token;
    const { error } = await supabase.from("ig_connection").update({
      page_id: account.id,
      ig_user_id: account.instagram_business_account.id,
      ig_username: account.instagram_business_account.username || null,
      access_token: pageToken,
      app_secret: appSecret,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) throw error;
    invalidateIgConnectionCache();
    res.redirect(`${returnUrl}?instagramAuth=connected`);
  } catch (err) {
    console.error("Instagram OAuth callback failed:", err.message);
    res.redirect(`${returnUrl}?instagramAuth=error`);
  }
});

export { callbackRouter as instagramAuthCallbackRouter };
export default router;