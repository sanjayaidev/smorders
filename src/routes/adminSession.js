import { Router } from "express";
import { timingSafeEqual } from "crypto";
import "dotenv/config";

const router = Router();

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/admin/login
 * body: { password: string }
 *
 * On success returns { token }, which is just the password itself - the
 * client stores it and sends it back as `Authorization: Bearer <token>` on
 * every admin request. See middleware/adminAuth.js for the trade-offs.
 */
router.post("/", (req, res) => {
  const adminPass = process.env.ADMIN_PASS;
  if (!adminPass) {
    return res.status(500).json({ error: "Server missing ADMIN_PASS configuration." });
  }

  const { password } = req.body || {};
  if (typeof password !== "string" || !safeEqual(password, adminPass)) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  res.json({ token: adminPass });
});

export default router;
