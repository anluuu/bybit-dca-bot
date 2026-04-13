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
  isTest: boolean;
  executedAt: string;
  createdAt: string;
}

/**
 * Dry-run preview of what a test order would do right now.
 * No order is placed. Generated on POST /api/test/preview.
 */
export interface TestOrderPreview {
  pair: string;
  testAmountBrl: number;
  currentPrice: number;
  estimatedQty: number;
  /** Monthly spend of *real* (non-test) orders; purely informational. */
  monthlySpent: number;
  monthlyCap: number;
  /** True if another pending/test order on this pair is active and execution would be blocked. */
  busy: boolean;
  busyReason: string | null;
  generatedAt: string;
}

/**
 * Result of a real test order executed on POST /api/test/execute.
 * Always a small market order tagged is_test=true in the DB.
 */
export interface TestOrderResult {
  orderId: number;
  bybitOrderId: string | null;
  status: string;
  pair: string;
  price: string | null;
  quantity: string | null;
  fiatSpent: string | null;
  fee: string | null;
  feeCurrency: string | null;
  executedAt: string;
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
