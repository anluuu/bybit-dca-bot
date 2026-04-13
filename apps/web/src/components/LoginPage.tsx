import { useState, type FormEvent } from "react";
import { Bitcoin, LogIn, AlertCircle } from "lucide-react";
import { useAuth } from "../lib/auth.tsx";

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-glow/10 border border-amber-glow/20">
            <Bitcoin className="h-7 w-7 text-amber-glow" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-surface-100">DCA Bot</h1>
            <p className="mt-1 text-sm text-surface-400">
              Sign in to access the dashboard
            </p>
          </div>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-6 backdrop-blur-sm"
        >
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-loss/20 bg-red-loss/10 px-3 py-2 text-sm text-red-loss">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="mb-4">
            <label
              htmlFor="username"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-surface-400"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="w-full rounded-lg border border-surface-700/50 bg-surface-800/80 px-3 py-2.5 font-mono text-sm text-surface-100 placeholder-surface-500 outline-none transition-colors focus:border-amber-glow/50 focus:ring-1 focus:ring-amber-glow/20"
              placeholder="admin"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-surface-400"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-surface-700/50 bg-surface-800/80 px-3 py-2.5 font-mono text-sm text-surface-100 placeholder-surface-500 outline-none transition-colors focus:border-amber-glow/50 focus:ring-1 focus:ring-amber-glow/20"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-amber-glow px-4 py-2.5 text-sm font-semibold text-surface-950 transition-colors hover:bg-amber-soft disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-surface-950/20 border-t-surface-950" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-surface-500">
          Public dashboard available without login
        </p>
      </div>
    </div>
  );
}
