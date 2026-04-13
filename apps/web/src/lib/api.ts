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
  TestOrderPreview,
  TestOrderResult,
  MonthlyBreakdown,
  PublicMonthlyBreakdown,
  PublicOrder,
  PublicOrdersPage,
  PublicStatus,
  PublicSignals,
  SignalFallback,
} from "@dca/shared";
