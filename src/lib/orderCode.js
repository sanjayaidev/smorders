import { randomBytes } from "crypto";

export function generateOrderCode() {
  return `SIM-${randomBytes(3).toString("hex").toUpperCase()}`;
}
