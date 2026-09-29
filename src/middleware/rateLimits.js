import rateLimit from "express-rate-limit";

const base = {
  standardHeaders: true,
  legacyHeaders: false,
};
const msg = (error) => ({ error });

// Limits are per IP. A cafe's customers often share one wifi IP, so the
// customer-facing limits are deliberately generous; the strict ones only
// count failures.

// AI assistant: every call spends Alibaba credits.
export const assistantLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 30,
  message: msg("Too many messages, please slow down."),
});

// Placing orders: stops kitchen spam without blocking a busy lunch.
export const orderCreateLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 30,
  message: msg("Too many orders from this network. Please try again shortly."),
});

// Order status polling (frontend polls every 8s). Only FAILED lookups (404)
// count toward the strict limit, which blocks order-code guessing.
export const orderLookupFailLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: msg("Too many failed lookups. Please try again later."),
});
export const orderLookupLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 240,
  message: msg("Too many requests."),
});

// Admin login: brute-force protection. Successful logins don't count.
export const adminLoginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: msg("Too many login attempts. Try again in 15 minutes."),
});

// Every admin API call is a password check (Bearer ADMIN_PASS), so cap
// failed attempts there too.
export const adminApiFailLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  message: msg("Too many failed attempts."),
});
