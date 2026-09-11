import { Router } from "express";
import { supabase } from "../supabaseClient.js";

const router = Router();

/**
 * GET /api/admin/webhook-events?platform=whatsapp|instagram&limit=100
 *
 * Newest first. Backs the admin "Webhook Log" page - shows every inbound
 * webhook POST (real message, status update, or Meta's test payload) for
 * both channels, regardless of whether it passed signature verification.
 */
router.get("/", async (req, res, next) => {
  try {
    const { platform, limit } = req.query;
    if (platform && !["whatsapp", "instagram"].includes(platform)) {
      return res.status(400).json({ error: "platform must be 'whatsapp' or 'instagram'." });
    }

    const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
    let query = supabase
      .from("webhook_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(cappedLimit);
    if (platform) query = query.eq("platform", platform);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ events: data });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/webhook-events
 * Clears the log - handy after a burst of test sends clutters the page.
 */
router.delete("/", async (req, res, next) => {
  try {
    const { error } = await supabase
      .from("webhook_events")
      .delete()
      .not("id", "is", null); // matches every row; Supabase requires a filter on delete
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
