import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bitcoin, LogIn, LogOut, Eye, AlertTriangle } from "lucide-react";
import { StatusCard } from "./components/StatusCard.tsx";
import { SpendingCard } from "./components/SpendingCard.tsx";
import { AccumulationChart } from "./components/AccumulationChart.tsx";
import { MonthlyOverview } from "./components/MonthlyOverview.tsx";
import { OrdersTable } from "./components/OrdersTable.tsx";
import { TestOrderCard } from "./components/TestOrderCard.tsx";
import { LoginPage } from "./components/LoginPage.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { AuthProvider, useAuth } from "./lib/auth.tsx";
import type {
  Asset,
  OrdersPage,
  OrdersSummary,
  HealthStatus,
  ChartPoint,
  MonthlyBreakdown,
  PublicMonthlyBreakdown,
  PublicOrdersPage,
  PublicStatus,
} from "./lib/api.ts";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 30_000,
      retry: 2,
    },
  },
});

// --- Hooks for authenticated (admin) data ---

function useOrders(page: number, pageSize: number = 25) {
  return useQuery<OrdersPage>({
    queryKey: ["orders", page, pageSize],
    queryFn: async () => {
      const res = await fetch(
        `/api/orders?page=${page}&pageSize=${pageSize}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`Failed to load orders (${res.status})`);
      return res.json();
    },
  });
}

function useAssets() {
  return useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: async () => {
      const res = await fetch("/api/assets", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load assets (${res.status})`);
      return res.json();
    },
  });
}

function useSummary() {
  return useQuery<OrdersSummary>({
    queryKey: ["summary"],
    queryFn: async () => {
      const res = await fetch("/api/orders/summary", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load summary (${res.status})`);
      return res.json();
    },
  });
}

function useMonthly() {
  return useQuery<MonthlyBreakdown[]>({
    queryKey: ["monthly"],
    queryFn: async () => {
      const res = await fetch("/api/orders/monthly", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load monthly (${res.status})`);
      return res.json();
    },
  });
}

// --- Hooks for public data ---

function usePublicSummary() {
  return useQuery<OrdersSummary>({
    queryKey: ["public-summary"],
    queryFn: async () => {
      const res = await fetch("/api/public/summary");
      if (!res.ok) throw new Error();
      return res.json();
    },
  });
}

function usePublicChart() {
  return useQuery<ChartPoint[]>({
    queryKey: ["public-chart"],
    queryFn: async () => {
      const res = await fetch("/api/public/chart");
      if (!res.ok) throw new Error();
      return res.json();
    },
  });
}

function usePublicMonthly() {
  return useQuery<PublicMonthlyBreakdown[]>({
    queryKey: ["public-monthly"],
    queryFn: async () => {
      const res = await fetch("/api/public/monthly");
      if (!res.ok) throw new Error();
      return res.json();
    },
  });
}

function usePublicOrders(page: number, pageSize: number = 25) {
  return useQuery<PublicOrdersPage>({
    queryKey: ["public-orders", page, pageSize],
    queryFn: async () => {
      const res = await fetch(
        `/api/public/orders?page=${page}&pageSize=${pageSize}`
      );
      if (!res.ok) throw new Error();
      return res.json();
    },
  });
}

function usePublicStatus() {
  return useQuery<PublicStatus>({
    queryKey: ["public-status"],
    queryFn: async () => {
      const res = await fetch("/api/public/status");
      if (!res.ok) throw new Error();
      return res.json();
    },
  });
}

function useHealth() {
  return useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/health/ready");
      if (!res.ok) throw new Error();
      return res.json();
    },
    refetchInterval: 10_000,
  });
}

// --- Error banner ---

function ErrorBanner({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-loss/30 bg-red-loss/10 px-5 py-3">
      <AlertTriangle className="h-5 w-5 shrink-0 text-red-loss" />
      <div>
        <p className="text-sm font-medium text-red-loss">
          {t("errors.failedToLoad")}
        </p>
        <p className="text-xs text-red-loss/70">{message}</p>
      </div>
    </div>
  );
}

// --- Language switcher (minimal toggle) ---

function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const next = i18n.resolvedLanguage === "pt-BR" ? "en" : "pt-BR";
  return (
    <button
      onClick={() => void i18n.changeLanguage(next)}
      className="flex cursor-pointer items-center gap-1 rounded-lg border border-surface-700/30 bg-surface-800/40 px-2.5 py-1.5 font-mono text-xs text-surface-300 transition-colors hover:border-amber-glow/30 hover:text-amber-glow"
      title={next === "pt-BR" ? "Português" : "English"}
    >
      {i18n.resolvedLanguage === "pt-BR" ? "PT" : "EN"}
    </button>
  );
}

// --- Admin Dashboard (full access) ---

function AdminDashboard() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [page, setPage] = useState(1);
  const { data: ordersPage, error: ordersError } = useOrders(page);
  const { data: assets, error: assetsError } = useAssets();
  const { data: summary, error: summaryError } = useSummary();
  const { data: monthly, error: monthlyError } = useMonthly();
  const { data: health } = useHealth();

  const apiError = ordersError || assetsError || summaryError || monthlyError;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-glow/10 border border-amber-glow/20">
          <Bitcoin className="h-5 w-5 text-amber-glow" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-surface-100">
            {t("app.title")}
          </h1>
          <p className="text-xs text-surface-400">{t("app.subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-surface-700/30 bg-surface-800/40 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-gain" />
            <span className="font-mono text-xs text-surface-300">
              {assets?.[0]?.pair ?? "BTCBRL"}
            </span>
          </div>
          <span className="hidden sm:inline text-xs text-surface-400">
            {user?.username}
          </span>
          <LanguageSwitcher />
          <button
            onClick={logout}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-700/30 bg-surface-800/40 px-3 py-1.5 text-xs text-surface-300 transition-colors hover:border-red-loss/30 hover:text-red-loss"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t("app.logout")}
          </button>
        </div>
      </header>

      {apiError && <ErrorBanner message={apiError.message} />}

      {summary && health && (
        <div className="mb-6 grid gap-6 md:grid-cols-2">
          <StatusCard health={health} asset={assets?.[0]} />
          <SpendingCard summary={summary} />
        </div>
      )}

      {ordersPage && (
        <>
          <div className="mb-6">
            <AccumulationChart orders={ordersPage.data} />
          </div>
          {monthly && (
            <div className="mb-6">
              <MonthlyOverview data={monthly} variant="admin" />
            </div>
          )}
          <div className="mb-6">
            <OrdersTable
              orders={ordersPage.data}
              page={ordersPage.page}
              totalPages={ordersPage.totalPages}
              total={ordersPage.total}
              onPageChange={setPage}
            />
          </div>
        </>
      )}

      {assets?.[0] && (
        <div>
          <TestOrderCard pair={assets[0].pair} />
        </div>
      )}
    </div>
  );
}

// --- Public Dashboard (read-only, limited data) ---

function PublicDashboard() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data: summary } = usePublicSummary();
  const { data: chartPoints } = usePublicChart();
  const { data: monthly } = usePublicMonthly();
  const { data: ordersPage } = usePublicOrders(page);
  const { data: status } = usePublicStatus();
  const { data: health } = useHealth();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-glow/10 border border-amber-glow/20">
          <Bitcoin className="h-5 w-5 text-amber-glow" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-surface-100">
            {t("app.title")}
          </h1>
          <p className="text-xs text-surface-400">{t("app.subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-surface-700/30 bg-surface-800/40 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-gain" />
            <span className="font-mono text-xs text-surface-300">
              {status?.pair ?? "BTCBRL"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-surface-700/30 bg-surface-800/40 px-3 py-1.5">
            <Eye className="h-3.5 w-3.5 text-surface-400" />
            <span className="text-xs text-surface-400">{t("app.publicView")}</span>
          </div>
          <LanguageSwitcher />
          <a
            href="#login"
            onClick={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("show-login"));
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-glow/20 bg-amber-glow/10 px-3 py-1.5 text-xs text-amber-glow transition-colors hover:bg-amber-glow/20"
          >
            <LogIn className="h-3.5 w-3.5" />
            {t("app.signIn")}
          </a>
        </div>
      </header>

      {summary && health && (
        <div className="mb-6 grid gap-6 md:grid-cols-2">
          <StatusCard health={health} asset={status} />
          <SpendingCard summary={summary} />
        </div>
      )}

      {chartPoints && (
        <div className="mb-6">
          <AccumulationChart points={chartPoints} />
        </div>
      )}

      {monthly && (
        <div className="mb-6">
          <MonthlyOverview data={monthly} variant="admin" />
        </div>
      )}

      {ordersPage && (
        <div className="mb-6">
          <OrdersTable
            orders={ordersPage.data}
            page={ordersPage.page}
            totalPages={ordersPage.totalPages}
            total={ordersPage.total}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}

// --- Router ---

function AppRouter() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-amber-glow/20 border-t-amber-glow" />
      </div>
    );
  }

  if (user) return <AdminDashboard />;

  return <PublicOrLogin />;
}

function PublicOrLogin() {
  const [showLogin, setShowLogin] = useState(
    () => window.location.hash === "#login"
  );

  useEffect(() => {
    function handleShowLogin() {
      setShowLogin(true);
    }
    window.addEventListener("show-login", handleShowLogin);
    return () => window.removeEventListener("show-login", handleShowLogin);
  }, []);

  if (showLogin) return <LoginPage />;
  return <PublicDashboard />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
