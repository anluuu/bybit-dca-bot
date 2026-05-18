import { SignalsTable } from "../components/copy/SignalsTable.tsx";
import { StatsCard } from "../components/copy/StatsCard.tsx";
import { TradesTable } from "../components/copy/TradesTable.tsx";

export function CopyTraderPage() {
  return (
    <div className="space-y-8 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Copy Trader</h1>
        <p className="text-sm text-surface-400">
          Live ingestion + dry-run executor for Mack signals.
        </p>
      </header>

      <section>
        <StatsCard />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">Trades</h2>
        <TradesTable />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">Signals</h2>
        <SignalsTable />
      </section>
    </div>
  );
}
