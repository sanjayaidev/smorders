import { Router } from "express";
import { supabase } from "../supabaseClient.js";

const router = Router();

const CATEGORY_FIELDS = ["slug", "icon", "sort_order", "active", "name"];

function pickCategoryFields(body) {
  const payload = {};
  for (const field of CATEGORY_FIELDS) {
    if (body[field] !== undefined) payload[field] = body[field];
  }
  return payload;
}

/**
 * POST /api/admin/categories
 * body: { slug, name: {en, tr, kk, ru}, icon?, sort_order?, active? }
 */
router.post("/", async (req, res, next) => {
  try {
    const payload = pickCategoryFields(req.body || {});
    if (!payload.slug || !payload.name) {
      return res.status(400).json({ error: "slug and name are required." });
    }

    const { data, error } = await supabase.from("categories").insert(payload).select().single();
    if (error) throw error;

    res.status(201).json({ category: data });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/categories/:id
 * body: any subset of CATEGORY_FIELDS to update.
 */
router.put("/:id", async (req, res, next) => {
  try {
    const payload = pickCategoryFields(req.body || {});
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "No updatable fields provided." });
    }

    const { data, error } = await supabase
      .from("categories")
      .update(payload)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Category not found." });

    res.json({ category: data });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/categories/:id
 * Will fail with a foreign-key error if products still reference this
 * category - Supabase/Postgres will surface that as a 500; move or delete
 * those products first.
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const { error } = await supabase.from("categories").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
