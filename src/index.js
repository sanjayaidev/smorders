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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
app.use(express.json());

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
