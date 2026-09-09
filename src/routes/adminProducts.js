import { Router } from "express";
import { supabase } from "../supabaseClient.js";

const router = Router();

const PRODUCT_FIELDS = [
  "category_id",
  "slug",
  "emoji",
  "image_url",
  "price",
  "currency",
  "weight_note",
  "coming_soon",
  "sort_order",
  "active",
  "name",
  "description",
];

function pickProductFields(body) {
  const payload = {};
  for (const field of PRODUCT_FIELDS) {
    if (body[field] !== undefined) payload[field] = body[field];
  }
  return payload;
}

/**
 * GET /api/admin/products
 * Everything, including inactive and "coming soon" items - unlike the
 * public /api/menu endpoint, which filters those out for customers.
 */
router.get("/", async (req, res, next) => {
  try {
    const { data: categories, error: catError } = await supabase
      .from("categories")
      .select("id, slug, icon, image_url, sort_order, active, name")
      .order("sort_order");
    if (catError) throw catError;

    const { data: products, error: prodError } = await supabase
      .from("products")
      .select(
        "id, category_id, slug, emoji, image_url, price, currency, weight_note, coming_soon, sort_order, active, name, description"
      )
      .order("sort_order");
    if (prodError) throw prodError;

    res.json({ categories, products });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/products
 * body: any subset of PRODUCT_FIELDS. category_id and slug are required.
 * name/description are jsonb i18n objects, e.g. { en: "...", tr: "...", kk: "...", ru: "..." }.
 */
router.post("/", async (req, res, next) => {
  try {
    const payload = pickProductFields(req.body || {});
    if (!payload.category_id || !payload.slug) {
      return res.status(400).json({ error: "category_id and slug are required." });
    }

    const { data, error } = await supabase.from("products").insert(payload).select().single();
    if (error) throw error;

    res.status(201).json({ product: data });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/products/:id
 * body: any subset of PRODUCT_FIELDS to update.
 */
router.put("/:id", async (req, res, next) => {
  try {
    const payload = pickProductFields(req.body || {});
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "No updatable fields provided." });
    }

    const { data, error } = await supabase
      .from("products")
      .update(payload)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Product not found." });

    res.json({ product: data });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/products/:id
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const { error } = await supabase.from("products").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
