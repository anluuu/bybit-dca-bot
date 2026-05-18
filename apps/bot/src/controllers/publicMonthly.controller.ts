import { getMonthlyBreakdown } from "../services/orders.service.js";

// Full breakdown is safe to expose publicly — orderCount / min / max
// are derivable from the public chart and aren't escalatable.
export async function getMonthly() {
  return getMonthlyBreakdown();
}
