import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Bitcoin, LogIn, LogOut, Eye } from "lucide-react";
import { StatusCard } from "./components/StatusCard.tsx";
import { SpendingCard } from "./components/SpendingCard.tsx";
import { AccumulationChart } from "./components/AccumulationChart.tsx";
import { OrdersTable } from "./components/OrdersTable.tsx";
import { LoginPage } from "./components/LoginPage.tsx";
import { AuthProvider, useAuth } from "./lib/auth.tsx";
import { mockOrders, mockAssets, mockSummary, mockHealth } from "./lib/mock-data.ts";
import type { Order, Asset, OrdersSummary, HealthStatus } from "./lib/api.ts";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 30_000,
      retry: 2,
    },
  },
});

// --- Hooks for authenticated (admin) data ---

function useOrders() {
  return useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: async () => {
      const res = await fetch("/api/orders", { credentials: "include" });
      if (!res.ok) throw new Error("Unauthorized");
      return res.json();
    },
  });
}

function useAssets() {
  return useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: async () => {
      const res = await fetch("/api/assets", { credentials: "include" });
      if (!res.ok) throw new Error("Unauthorized");
      return res.json();
    },
  });
}

function useSummary() {
  return useQuery<OrdersSummary>({
    queryKey: ["summary"],
    queryFn: async () => {
      const res = await fetch("/api/orders/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Unauthorized");
      return res.json();
    },
  });
}

// --- Hooks for public data ---

function usePublicSummary() {
  return useQuery<OrdersSummary>({
    queryKey: ["public-summary"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/public/summary");
        if (!res.ok) throw new Error();
        return res.json();
      } catch {
        return mockSummary;
      }
    },
  });
}

interface ChartPoint {
  date: string;
  btc: number;
  spent: number;
}

function usePublicChart() {
  return useQuery<ChartPoint[]>({
    queryKey: ["public-chart"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/public/chart");
        if (!res.ok) throw new Error();
        return res.json();
      } catch {
        return [];
      }
    },
  });
}

function useHealth() {
  return useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: async () => {
      try {
        const res = await fetch("/health/ready");
        if (!res.ok) throw new Error();
        return res.json();
      } catch {
        return mockHealth;
      }
    },
    refetchInterval: 10_000,
  });
}

// --- Admin Dashboard (full access) ---

function AdminDashboard() {
  const { user, logout } = useAuth();
  const { data: orders = mockOrders } = useOrders();
  const { data: assets = mockAssets } = useAssets();
  const { data: summary = mockSummary } = useSummary();
  const { data: health = mockHealth } = useHealth();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-glow/10 border border-amber-glow/20">
          <Bitcoin className="h-5 w-5 text-amber-glow" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-surface-100">
            DCA Bot
          </h1>
          <p className="text-xs text-surface-400">
            Automated Bitcoin accumulation on Bybit
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-surface-700/30 bg-surface-800/40 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-gain" />
            <span className="font-mono text-xs text-surface-300">
              {assets[0]?.pair ?? "BTCBRL"}
            </span>
          </div>
          <span className="hidden sm:inline text-xs text-surface-400">
            {user?.username}
          </span>
          <button
            onClick={logout}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-700/30 bg-surface-800/40 px-3 py-1.5 text-xs text-surface-300 transition-colors hover:border-red-loss/30 hover:text-red-loss"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </header>

      <div className="mb-6 grid gap-6 md:grid-cols-2">
        <StatusCard health={health} asset={assets[0]} />
        <SpendingCard summary={summary} />
      </div>

      <div className="mb-6">
        <AccumulationChart orders={orders} />
      </div>

      <div>
        <OrdersTable orders={orders} />
      </div>
    </div>
  );
}

// --- Public Dashboard (read-only, limited data) ---

function PublicDashboard() {
  const { data: summary = mockSummary } = usePublicSummary();
  const { data: health = mockHealth } = useHealth();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-glow/10 border border-amber-glow/20">
          <Bitcoin className="h-5 w-5 text-amber-glow" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-surface-100">
            DCA Bot
          </h1>
          <p className="text-xs text-surface-400">
            Automated Bitcoin accumulation on Bybit
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-surface-700/30 bg-surface-800/40 px-3 py-1.5">
            <Eye className="h-3.5 w-3.5 text-surface-400" />
            <span className="text-xs text-surface-400">Public view</span>
          </div>
          <a
            href="#login"
            onClick={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("show-login"));
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-glow/20 bg-amber-glow/10 px-3 py-1.5 text-xs text-amber-glow transition-colors hover:bg-amber-glow/20"
          >
            <LogIn className="h-3.5 w-3.5" />
            Sign in
          </a>
        </div>
      </header>

      {/* Public: only summary stats, no detailed orders */}
      <div className="mb-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
          <h2 className="mb-4 text-sm font-semibold tracking-wide uppercase text-surface-300">
            Bot Status
          </h2>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex h-3 w-3">
              {health.status === "ok" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-gain opacity-40" />
              )}
              <span
                className={`relative inline-flex h-3 w-3 rounded-full ${health.status === "ok" ? "bg-green-gain" : "bg-red-loss"}`}
              />
            </div>
            <span className="font-mono text-sm font-medium text-surface-100">
              {health.status === "ok" ? "Running" : "Degraded"}
            </span>
          </div>
          <p className="text-xs text-surface-500">
            Sign in to view full service details
          </p>
        </div>

        <SpendingCard summary={summary} />
      </div>

      {/* Locked sections */}
      <div className="mb-6 rounded-xl border border-surface-700/30 bg-surface-900/50 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-surface-700/30 bg-surface-800/50">
          <LogIn className="h-5 w-5 text-surface-400" />
        </div>
        <p className="text-sm font-medium text-surface-300">
          Sign in to view purchase history and detailed charts
        </p>
        <p className="mt-1 text-xs text-surface-500">
          The public view shows summary statistics only
        </p>
      </div>
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

import { useState, useEffect } from "react";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </QueryClientProvider>
  );
}
