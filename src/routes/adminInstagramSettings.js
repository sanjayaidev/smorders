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
  "owner_ig_sender_id",
];

/** GET /api/admin/instagram/settings */
router.get("/", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("ig_settings").select("*").eq("id", 1).single();
    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/instagram/settings
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
      if (!Number.isFinite(n) || n < 1) {
        return res.status(400).json({ error: "followup_delay_minutes must be a positive integer." });
      }
      patch.followup_delay_minutes = n;
    }

    const { data, error } = await supabase
      .from("ig_settings")
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
