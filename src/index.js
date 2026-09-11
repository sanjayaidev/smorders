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
import instagramWebhookRouter from "./routes/instagramWebhook.js";
import adminInstagramSettingsRouter from "./routes/adminInstagramSettings.js";
import adminInstagramKeywordsRouter from "./routes/adminInstagramKeywords.js";
import adminInstagramConnectionRouter from "./routes/adminInstagramConnection.js";
import adminInstagramAuthRouter, { instagramAuthCallbackRouter } from "./routes/adminInstagramAuth.js";
import adminWebhookEventsRouter from "./routes/adminWebhookEvents.js";
import { sendPendingFollowups } from "./lib/waBot.js";
import { sendPendingIgFollowups } from "./lib/igBot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
// Meta signatures cover the exact bytes received. Parse these public routes
// as raw JSON before the global JSON parser runs.
app.use(["/webhooks/whatsapp", "/webhooks/instagram", "/api/whatsapp/webhook", "/api/instagram/webhook"], express.raw({
  type: "application/json",
  limit: "2mb",
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
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
app.use("/api/admin/instagram/settings", adminAuth, adminInstagramSettingsRouter);
app.use("/api/admin/instagram/keywords", adminAuth, adminInstagramKeywordsRouter);
app.use("/api/admin/instagram/connection", adminAuth, adminInstagramConnectionRouter);
app.use("/api/admin/webhook-events", adminAuth, adminWebhookEventsRouter);
app.use("/api/admin/instagram", adminAuth, adminInstagramAuthRouter);
app.use("/api/auth/instagram", instagramAuthCallbackRouter);

// Meta's webhook - no adminAuth (Meta can't send our admin password), it's
// gated instead by the verify token (GET) and X-Hub-Signature-256 (POST).
app.use("/api/whatsapp/webhook", whatsappWebhookRouter);
app.use("/webhooks/whatsapp", whatsappWebhookRouter);

// Same reasoning as the WhatsApp webhook above: no adminAuth, gated instead
// by the verify token (GET) and X-Hub-Signature-256 (POST).
app.use("/api/instagram/webhook", instagramWebhookRouter);
app.use("/webhooks/instagram", instagramWebhookRouter);

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

// Checks every minute for WhatsApp/Instagram conversations that have gone
// quiet mid-order and sends the admin-configured follow-up nudge once each.
setInterval(() => {
  sendPendingFollowups().catch((err) => console.error("sendPendingFollowups crashed:", err));
  sendPendingIgFollowups().catch((err) => console.error("sendPendingIgFollowups crashed:", err));
}, 60 * 1000);
