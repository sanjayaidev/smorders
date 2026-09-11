import { Router } from "express";
import { supabase } from "../supabaseClient.js";
import { invalidateWaConnectionCache } from "../lib/waConnection.js";
import { subscribeWhatsAppWebhook } from "../lib/metaSubscriptions.js";

const router = Router();
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

function publicBaseUrl(req) {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (process.env.APP_BASE_URL || `${forwardedProto || req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function maskToken(token) {
  if (!token) return null;
  return token.length <= 8 ? "••••••••" : `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

/**
 * GET /api/admin/whatsapp/connection
 * Returns the current connection with the access token masked - the admin
 * page never needs (or should display) the raw token after it's saved.
 */
router.get("/", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("wa_connection").select("*").eq("id", 1).single();
    if (error) throw error;
    res.json({
      connection: {
        wabaId: data.waba_id,
        accessTokenMasked: maskToken(data.access_token),
        hasAccessToken: Boolean(data.access_token),
        appSecretSet: Boolean(data.app_secret),
        phoneNumberId: data.phone_number_id,
        phoneNumberDisplay: data.phone_number_display,
        // The verify token now lives only in WHATSAPP_VERIFY_TOKEN (env) -
        // it's a static shared secret for Meta's webhook config, not
        // something the admin UI needs to display or let anyone change.
        webhookUrl: `${publicBaseUrl(req)}/api/whatsapp/webhook`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/whatsapp/connection/lookup
 * body: { wabaId, accessToken }
 *
 * Calls Graph API for the phone numbers under this WABA so the admin can
 * pick one - doesn't save anything yet. Also returned as the response is
 * whether it auto-resolves to a single number, so the client can skip the
 * picker UI when there's nothing to choose between.
 */
router.post("/lookup", async (req, res, next) => {
  try {
    const { wabaId, accessToken } = req.body || {};
    if (!wabaId?.trim() || !accessToken?.trim()) {
      return res.status(400).json({ error: "wabaId and accessToken are required." });
    }

    const url = `https://graph.facebook.com/${API_VERSION}/${wabaId.trim()}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`;
    const graphRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken.trim()}` } });
    const payload = await graphRes.json().catch(() => null);

    if (!graphRes.ok) {
      const message = payload?.error?.message || `Meta rejected that WABA ID / token (${graphRes.status}).`;
      return res.status(400).json({ error: message });
    }

    const numbers = (payload?.data || []).map((n) => ({
      id: n.id,
      displayPhoneNumber: n.display_phone_number,
      verifiedName: n.verified_name,
      qualityRating: n.quality_rating,
    }));

    if (numbers.length === 0) {
      return res.status(404).json({ error: "That WABA has no phone numbers registered yet." });
    }

    res.json({ numbers });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/whatsapp/connection
 * body: { wabaId, accessToken, phoneNumberId, phoneNumberDisplay, appSecret? }
 *
 * Saves the chosen connection. Called after /lookup, once the admin has
 * picked a number (or there was only one to pick).
 */
router.post("/", async (req, res, next) => {
  try {
    const { wabaId, accessToken, phoneNumberId, phoneNumberDisplay, appSecret } = req.body || {};
    if (!wabaId?.trim() || !accessToken?.trim() || !phoneNumberId?.trim()) {
      return res.status(400).json({ error: "wabaId, accessToken and phoneNumberId are required." });
    }

    const patch = {
      waba_id: wabaId.trim(),
      access_token: accessToken.trim(),
      phone_number_id: phoneNumberId.trim(),
      phone_number_display: phoneNumberDisplay || null,
      updated_at: new Date().toISOString(),
    };
    if (appSecret !== undefined) patch.app_secret = appSecret?.trim() || null;

    const { data, error } = await supabase.from("wa_connection").update(patch).eq("id", 1).select().single();
    if (error) throw error;

    invalidateWaConnectionCache();
    let webhookSubscription;
    try {
      webhookSubscription = await subscribeWhatsAppWebhook(data.waba_id, data.access_token);
    } catch (subscriptionError) {
      return res.status(502).json({
        error: `WhatsApp was saved, but Meta could not subscribe the number to webhooks: ${subscriptionError.message}`,
      });
    }

    res.json({
      webhookSubscription,
      connection: {
        wabaId: data.waba_id,
        accessTokenMasked: maskToken(data.access_token),
        hasAccessToken: Boolean(data.access_token),
        appSecretSet: Boolean(data.app_secret),
        phoneNumberId: data.phone_number_id,
        phoneNumberDisplay: data.phone_number_display,
        webhookUrl: `${publicBaseUrl(req)}/api/whatsapp/webhook`,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
