import { Router } from "express";
import { supabase } from "../supabaseClient.js";

const router = Router();

const EDITABLE_FIELDS = [
  "welcome_message",
  "order_button_label",
  "location_button_label",
  "menu_button_label",
  "followup_message",
  "followup_delay_minutes",
  "owner_whatsapp_number",
];

/** GET /api/admin/whatsapp/settings */
router.get("/", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("wa_settings").select("*").eq("id", 1).single();
    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/whatsapp/settings
 * body: any subset of EDITABLE_FIELDS
 */
router.put("/", async (req, res, next) => {
  try {
    const patch = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body?.[field] !== undefined) patch[field] = req.body[field];
    }
    if (patch.followup_delay_minutes !== undefined) {
      const n = parseInt(patch.followup_delay_minutes, 10);
      // Cap below 24h: the follow-up is sent as a free-form WhatsApp
      // "service message", which only works inside the 24-hour customer
      // service window that starts from the user's last message. A delay
      // at or beyond that window would mean the follow-up always arrives
      // too late to send and gets rejected (error code 131047) - a
      // template message would be required instead. 1380 min (23h) leaves
      // an hour of buffer.
      if (!Number.isFinite(n) || n < 1 || n > 1380) {
        return res
          .status(400)
          .json({ error: "followup_delay_minutes must be a positive integer no greater than 1380 (23 hours) - beyond that the WhatsApp customer service window will have closed." });
      }
      patch.followup_delay_minutes = n;
    }

    const { data, error } = await supabase
      .from("wa_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .select()
      .single();
    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    next(err);
  }
});

export default router;
