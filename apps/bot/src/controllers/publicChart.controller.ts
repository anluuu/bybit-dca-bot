import { getChartData } from "../services/orders.service.js";

export async function getChart() {
  return getChartData();
}
