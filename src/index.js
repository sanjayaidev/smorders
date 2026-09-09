import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import menuRouter from "./routes/menu.js";
import ordersRouter from "./routes/orders.js";
import uploadRouter from "./routes/upload.js";
import assistantRouter from "./routes/assistant.js";
import { adminAuth } from "./middleware/adminAuth.js";
import adminSessionRouter from "./routes/adminSession.js";
import adminOrdersRouter from "./routes/adminOrders.js";
import adminProductsRouter from "./routes/adminProducts.js";
import adminCategoriesRouter from "./routes/adminCategories.js";
import whatsappWebhookRouter from "./routes/whatsappWebhook.js";
import adminWhatsappSettingsRouter from "./routes/adminWhatsappSettings.js";
import adminWhatsappKeywordsRouter from "./routes/adminWhatsappKeywords.js";
import adminWhatsappConnectionRouter from "./routes/adminWhatsappConnection.js";
import { sendPendingFollowups } from "./lib/waBot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
// `verify` stashes the raw request body on req.rawBody - the WhatsApp
// webhook needs the exact bytes (not the reserialized object) to check
// Meta's X-Hub-Signature-256 header.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/menu", menuRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/assistant", assistantRouter);
// Base64 image payloads run bigger than express.json()'s 100kb default, so
// this route gets its own limit rather than raising it globally. It's
// gated behind adminAuth since it spends the server's IMGBB_API_KEY quota.
app.use("/api/upload", adminAuth, express.json({ limit: "40mb" }), uploadRouter);

// Admin dashboard API. /login just checks the password; everything else
// requires "Authorization: Bearer <ADMIN_PASS>" via adminAuth.
app.use("/api/admin/login", adminSessionRouter);
app.use("/api/admin/orders", adminAuth, adminOrdersRouter);
app.use("/api/admin/products", adminAuth, adminProductsRouter);
app.use("/api/admin/categories", adminAuth, adminCategoriesRouter);
app.use("/api/admin/whatsapp/settings", adminAuth, adminWhatsappSettingsRouter);
app.use("/api/admin/whatsapp/keywords", adminAuth, adminWhatsappKeywordsRouter);
app.use("/api/admin/whatsapp/connection", adminAuth, adminWhatsappConnectionRouter);

// Meta's webhook - no adminAuth (Meta can't send our admin password), it's
// gated instead by the verify token (GET) and X-Hub-Signature-256 (POST).
app.use("/api/whatsapp/webhook", whatsappWebhookRouter);

// Serve the customer-facing frontend (public/index.html) at the root,
// same-origin as the API - so fetch("/api/menu") just works with no
// CORS setup or hardcoded base URL needed.
app.use(express.static(path.join(__dirname, "..", "public")));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Simit Astana server listening on port ${PORT}`);
});

// Checks every minute for WhatsApp conversations that have gone quiet
// mid-order and sends the admin-configured follow-up nudge once each.
setInterval(() => {
  sendPendingFollowups().catch((err) => console.error("sendPendingFollowups crashed:", err));
}, 60 * 1000);
