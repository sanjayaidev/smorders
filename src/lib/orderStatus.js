import { supabase } from "../supabaseClient.js";
import { t } from "./botI18n.js";

const STATUS_KEYS = {
  on_queue: "statusOnQueue",
  preparing: "statusPreparing",
  delivered: "statusDelivered",
  cancelled: "statusCancelled",
};

const ORDER_COLUMNS = "id, order_code, status, cancellation_reason, total, currency, lang, channel, customer_ref, created_at";

/** True when Postgres/PostgREST says a column doesn't exist (migration not applied yet). */
export function isMissingColumnError(error) {
  if (!error) return false;
  return (
    error.code === "42703" || // undefined_column
    error.code === "PGRST204" || // PostgREST: column not in schema cache
    /customer_ref/.test(String(error.message || ""))
  );
}

let warnedMissingCustomerRef = false;

/**
 * The customer's most recent orders on this channel (default: last 24 hours).
 * Orders are linked to a customer by `orders.customer_ref` - the phone number
 * or Instagram/Messenger sender id. If the migration that adds that column
 * hasn't been run yet this returns [] instead of throwing, so the bots keep
 * working.
 */
export async function findRecentOrdersForCustomer(db = supabase, channel, customerRef, { hours = 24, limit = 3 } = {}) {
  if (!customerRef) return [];
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("channel", channel)
    .eq("customer_ref", String(customerRef))
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingColumnError(error)) {
      if (!warnedMissingCustomerRef) {
        warnedMissingCustomerRef = true;
        console.warn("orders.customer_ref is missing - run supabase/migrations/20260915_bot_convenience.sql to enable order status lookups.");
      }
      return [];
    }
    throw error;
  }
  return data || [];
}

export async function findOrderByCode(db = supabase, code) {
  const { data, error } = await db.from("orders").select(ORDER_COLUMNS).eq("order_code", code).maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) {
      // Fall back to the columns that always existed.
      const retry = await db
        .from("orders")
        .select("id, order_code, status, cancellation_reason, total, currency, lang, created_at")
        .eq("order_code", code)
        .maybeSingle();
      if (retry.error) throw retry.error;
      return retry.data;
    }
    throw error;
  }
  return data;
}

/** Attach `items` ([{product_name, quantity, unit_price}]) to each order. */
export async function attachOrderItems(db = supabase, orders) {
  if (!orders.length) return [];
  const { data, error } = await db
    .from("order_items")
    .select("order_id, product_name, quantity, unit_price")
    .in(
      "order_id",
      orders.map((order) => order.id)
    );
  if (error) throw error;
  return orders.map((order) => ({ ...order, items: (data || []).filter((item) => item.order_id === order.id) }));
}

export function statusLabel(status, language) {
  return t(language, STATUS_KEYS[status] || "statusOnQueue");
}

/** A short, readable status card for one order. */
export function formatOrderStatus(order, language) {
  const lines = [t(language, "statusHeader", { code: order.order_code }), t(language, "statusLine", { status: statusLabel(order.status, language) })];
  if (order.status === "cancelled" && order.cancellation_reason) {
    lines.push(t(language, "cancelReason", { reason: order.cancellation_reason }));
  }
  if (order.items?.length) {
    lines.push("");
    for (const item of order.items) lines.push(`${item.quantity}× ${item.product_name} - ${item.unit_price * item.quantity} ${order.currency}`);
    lines.push(t(language, "total", { total: order.total, currency: order.currency }));
  }
  return lines.join("\n");
}
