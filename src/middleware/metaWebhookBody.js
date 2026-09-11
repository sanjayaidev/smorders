export function parseMetaWebhookBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString("utf8"));
    } catch {
      return null;
    }
  }
  return req.body || null;
}