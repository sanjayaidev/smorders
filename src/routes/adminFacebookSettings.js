import { Router } from "express";
import { supabase } from "../supabaseClient.js";
const router = Router();
const EDITABLE_FIELDS = ["welcome_message", "order_button_label", "location_button_label", "menu_button_label", "followup_message", "followup_delay_minutes", "owner_fb_sender_id"];
router.get("/", async (req, res, next) => { try { const result = await supabase.from("fb_settings").select("*").eq("id", 1).single(); if (result.error) throw result.error; res.json({ settings: result.data }); } catch (error) { next(error); } });
router.put("/", async (req, res, next) => { try { const patch = {}; for (const field of EDITABLE_FIELDS) if (req.body?.[field] !== undefined) patch[field] = req.body[field]; if (patch.followup_delay_minutes !== undefined) { const value = Number.parseInt(patch.followup_delay_minutes, 10); if (!Number.isFinite(value) || value < 1) return res.status(400).json({ error: "followup_delay_minutes must be a positive integer." }); patch.followup_delay_minutes = value; } const result = await supabase.from("fb_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1).select().single(); if (result.error) throw result.error; res.json({ settings: result.data }); } catch (error) { next(error); } });
export default router;
