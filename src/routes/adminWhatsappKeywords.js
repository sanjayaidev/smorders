import { Router } from "express";
import { supabase } from "../supabaseClient.js";

const router = Router();

/** GET /api/admin/whatsapp/keywords */
router.get("/", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("wa_keywords")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    res.json({ keywords: data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/whatsapp/keywords
 * body: { keyword, response, matchType?: "contains"|"exact", active?: boolean }
 */
router.post("/", async (req, res, next) => {
  try {
    const { keyword, response, matchType = "contains", active = true } = req.body || {};
    if (!keyword?.trim() || !response?.trim()) {
      return res.status(400).json({ error: "keyword and response are required." });
    }
    if (!["contains", "exact"].includes(matchType)) {
      return res.status(400).json({ error: 'matchType must be "contains" or "exact".' });
    }

    const { data: maxRow } = await supabase
      .from("wa_keywords")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

    const { data, error } = await supabase
      .from("wa_keywords")
      .insert({
        keyword: keyword.trim(),
        response: response.trim(),
        match_type: matchType,
        active: Boolean(active),
        sort_order: nextSortOrder,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ keyword: data });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/whatsapp/keywords/:id
 * body: any subset of { keyword, response, matchType, active, sortOrder }
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const { keyword, response, matchType, active, sortOrder } = req.body || {};
    const patch = {};
    if (keyword !== undefined) patch.keyword = String(keyword).trim();
    if (response !== undefined) patch.response = String(response).trim();
    if (matchType !== undefined) {
      if (!["contains", "exact"].includes(matchType)) {
        return res.status(400).json({ error: 'matchType must be "contains" or "exact".' });
      }
      patch.match_type = matchType;
    }
    if (active !== undefined) patch.active = Boolean(active);
    if (sortOrder !== undefined) patch.sort_order = parseInt(sortOrder, 10) || 0;

    const { data, error } = await supabase
      .from("wa_keywords")
      .update(patch)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Keyword not found." });
    res.json({ keyword: data });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/whatsapp/keywords/:id */
router.delete("/:id", async (req, res, next) => {
  try {
    const { error } = await supabase.from("wa_keywords").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
