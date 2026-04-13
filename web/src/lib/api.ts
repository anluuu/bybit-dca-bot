const API_BASE = "/api";

export interface Order {
  id: number;
  assetId: number;
  pair: string;
  orderType: string;
  bybitOrderId: string | null;
  status: string;
  price: string | null;
  quantity: string | null;
  fiatSpent: string | null;
  fee: string | null;
  feeCurrency: string | null;
  errorMessage: string | null;
  executedAt: string;
  createdAt: string;
}

export interface Asset {
  id: number;
  pair: string;
  buyAmount: string;
  monthlyCap: string;
  cronSchedule: string;
  limitDiscount: string;
  limitWaitMins: number;
  enabled: boolean;
}

export interface HealthStatus {
  status: string;
  uptime: number;
  postgres?: string;
  redis?: string;
}

export interface OrdersSummary {
  totalOrders: number;
  totalBtc: number;
  totalSpent: number;
  monthlySpent: number;
  monthlyCap: number;
  avgPrice: number;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getOrders: () => fetchJson<Order[]>("/orders"),
  getAssets: () => fetchJson<Asset[]>("/assets"),
  getSummary: () => fetchJson<OrdersSummary>("/orders/summary"),
  getHealth: () =>
    fetch("/health/ready").then((r) => r.json() as Promise<HealthStatus>),
};
