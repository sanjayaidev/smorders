import { Router } from "express";
import { supabase } from "../supabaseClient.js";
import { generateOrderCode } from "../lib/orderCode.js";

const router = Router();

/**
 * POST /api/orders
 * body: {
 *   customerName: string,
 *   tableNo: string,
 *   lang?: "en" | "tr" | "kk"  (default "en"),
 *   customerNote?: string,
 *   items: [{ productId: string, quantity: number }]
 * }
 *
 * Prices are always re-read from the database - never trust a price sent
 * from the client, or anyone editing devtools could set their own total.
 */
router.post("/", async (req, res, next) => {
  try {
    const { customerName, tableNo, lang = "en", customerNote, items } = req.body;

    if (
      !customerName?.trim() ||
      !tableNo?.trim() ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        error: "customerName, tableNo and at least one item are required.",
      });
    }

    const productIds = items.map((i) => i.productId);
    const { data: products, error: prodError } = await supabase
      .from("products")
      .select("id, name, price, active")
      .in("id", productIds);
    if (prodError) throw prodError;

    const missing = productIds.filter((id) => !products.find((p) => p.id === id));
    if (missing.length > 0) {
      return res.status(400).json({ error: `Unknown product id(s): ${missing.join(", ")}` });
    }

    const lines = items.map((i) => {
      const product = products.find((p) => p.id === i.productId);
      const quantity = Math.max(1, parseInt(i.quantity, 10) || 1);
      return {
        product_id: product.id,
        product_name: product.name?.[lang] ?? product.name?.en ?? "",
        quantity,
        unit_price: product.price,
      };
    });

    const total = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_code: generateOrderCode(),
        channel: "web",
        customer_name: customerName,
        table_no: tableNo,
        customer_note: customerNote ?? null,
        lang,
        total,
        currency: "KZT",
        status: "on_queue",
      })
      .select()
      .single();
    if (orderError) throw orderError;

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(lines.map((l) => ({ ...l, order_id: order.id })));
    if (itemsError) throw itemsError;

    res.status(201).json({ order: { ...order, items: lines } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/:orderCode
 * Lets a customer check the status of their own order with the code
 * they were given at checkout (e.g. "SIM-A3F9K").
 */
router.get("/:orderCode", async (req, res, next) => {
  try {
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, order_code, status, cancellation_reason, total, currency, created_at")
      .eq("order_code", req.params.orderCode)
      .single();
    if (error || !order) return res.status(404).json({ error: "Order not found." });

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("product_name, quantity, unit_price")
      .eq("order_id", order.id);
    if (itemsError) throw itemsError;

    res.json({ order: { ...order, items } });
  } catch (err) {
    next(err);
  }
});

export default router;
