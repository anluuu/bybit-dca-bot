// Re-export shared API contract types from @dca/shared so existing
// component imports keep working. Single source of truth lives in the
// shared package.
export type {
  Order,
  Asset,
  OrdersPage,
  OrdersSummary,
  ChartPoint,
  HealthStatus,
  AuthUser,
} from "@dca/shared";
