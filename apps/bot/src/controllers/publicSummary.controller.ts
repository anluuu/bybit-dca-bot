import { getOrdersSummary } from "../services/orders.service.js";

export async function getSummary() {
  return getOrdersSummary();
}
