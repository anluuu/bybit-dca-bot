import { SignalsTable } from "../components/copy/SignalsTable.tsx";

export function CopyTraderPage() {
  return (
    <div className="space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Copy Trader — Signals</h1>
        <p className="text-sm text-gray-400">
          Live ingestion from the Telegram channel. F0: read-only listener.
        </p>
      </header>
      <SignalsTable />
    </div>
  );
}
