import { Router } from "express";
import { supabase } from "../supabaseClient.js";

const router = Router();

/**
 * GET /api/menu
 * GET /api/menu?lang=en|tr|kk|ru
 *
 * Without ?lang, returns categories/items with the raw {en,tr,kk,ru} objects
 * for name/description, so a client can switch languages instantly with
 * no refetch. With ?lang, flattens straight to strings in that language -
 * handy for a lightweight client, a chatbot, or quick curl testing.
 */
router.get("/", async (req, res, next) => {
  try {
    const { lang } = req.query;

    const { data: categories, error: catError } = await supabase
      .from("categories")
      .select("id, slug, icon, image_url, sort_order, name")
      .eq("active", true)
      .order("sort_order");
    if (catError) throw catError;

    const { data: products, error: prodError } = await supabase
      .from("products")
      .select(
        "id, category_id, slug, emoji, image_url, price, currency, weight_note, coming_soon, sort_order, name, description"
      )
      .eq("active", true)
      .order("sort_order");
    if (prodError) throw prodError;

    const flatten = (field) =>
      lang ? field?.[lang] ?? field?.en ?? "" : field;

    const shaped = categories.map((cat) => ({
      ...cat,
      name: flatten(cat.name),
      items: products
        .filter((p) => p.category_id === cat.id)
        .map((p) => ({
          ...p,
          name: flatten(p.name),
          description: flatten(p.description),
        })),
    }));

    res.json({ categories: shaped });
  } catch (err) {
    next(err);
  }
});

export default router;
