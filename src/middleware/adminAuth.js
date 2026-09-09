import { timingSafeEqual } from "crypto";
import "dotenv/config";

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Different lengths would short-circuit timingSafeEqual with a throw, so
  // pad first - this keeps the comparison itself constant-time either way.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Protects the admin API routes.
 *
 * This is intentionally simple: one shared password (ADMIN_PASS), sent as
 * `Authorization: Bearer <password>` on every request. There's no session
 * store or expiry - the "token" the client holds is just the password
 * itself. That's a reasonable trade-off for a single-admin kitchen
 * dashboard, but don't reuse this pattern for anything with multiple staff
 * accounts or real per-user permissions.
 */
export function adminAuth(req, res, next) {
  const adminPass = process.env.ADMIN_PASS;
  if (!adminPass) {
    console.error("Missing ADMIN_PASS. Set it in your environment to enable the admin API.");
    return res.status(500).json({ error: "Server missing ADMIN_PASS configuration." });
  }

  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token || !safeEqual(token, adminPass)) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  next();
}
