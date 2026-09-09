import { Router } from "express";
import { supabase } from "../supabaseClient.js";

const router = Router();

const ALLOWED_STATUSES = ["on_queue", "preparing", "delivered", "cancelled"];

/**
 * GET /api/admin/orders
 * GET /api/admin/orders?status=on_queue
 *
 * Newest first, with items nested under each order.
 */
router.get("/", async (req, res, next) => {
  try {
    const { status } = req.query;
    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}` });
    }

    let query = supabase
      .from("orders")
      .select(
        "id, order_code, customer_name, table_no, customer_note, lang, total, currency, status, cancellation_reason, created_at"
      )
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);

    const { data: orders, error } = await query;
    if (error) throw error;

    const orderIds = orders.map((o) => o.id);
    let itemsByOrder = {};
    if (orderIds.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from("order_items")
        .select("order_id, product_name, quantity, unit_price")
        .in("order_id", orderIds);
      if (itemsError) throw itemsError;

      itemsByOrder = items.reduce((acc, item) => {
        (acc[item.order_id] ??= []).push(item);
        return acc;
      }, {});
    }

    res.json({
      orders: orders.map((o) => ({ ...o, items: itemsByOrder[o.id] || [] })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/orders/:id
 * body: { status: "on_queue"|"preparing"|"delivered"|"cancelled", cancellationReason?: string }
 *
 * cancellationReason is required (and stored) when status is "cancelled",
 * and cleared for any other status.
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const { status, cancellationReason } = req.body || {};

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}` });
    }
    if (status === "cancelled" && !cancellationReason?.trim()) {
      return res.status(400).json({ error: "cancellationReason is required when cancelling an order." });
    }

    const { data: order, error } = await supabase
      .from("orders")
      .update({
        status,
        cancellation_reason: status === "cancelled" ? cancellationReason.trim() : null,
      })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!order) return res.status(404).json({ error: "Order not found." });

    res.json({ order });
  } catch (err) {
    next(err);
  }
});

export default router;
