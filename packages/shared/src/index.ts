// Shared API contract types — used by both bot (server) and web (client).
// These describe the JSON wire format, not the database row shape.

export type OrderType = "limit" | "market";
export type OrderStatus =
  | "pending"
  | "filled"
  | "cancelled"
  | "failed"
  | "skipped_cap";

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
  createdAt: string;
  updatedAt: string;
}

export interface OrdersPage {
  data: Order[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OrdersSummary {
  totalOrders: number;
  totalBtc: number;
  totalSpent: number;
  monthlySpent: number;
  monthlyCap: number;
  avgPrice: number;
}

export interface ChartPoint {
  date: string;
  btc: number;
  spent: number;
}

export interface HealthStatus {
  status: string;
  uptime: number;
  postgres?: string;
  redis?: string;
}

export interface AuthUser {
  username: string;
  role: string;
}
