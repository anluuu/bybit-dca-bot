import { useTranslation } from "react-i18next";
import { SignalsTable } from "../components/copy/SignalsTable.tsx";
import { TradesTable } from "../components/copy/TradesTable.tsx";
import { StatsCard } from "../components/copy/StatsCard.tsx";
import { SystemStatePanel } from "../components/copy/SystemStatePanel.tsx";
import { ConfigForm } from "../components/copy/ConfigForm.tsx";

export function CopyTraderPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-8 p-4">
      <header>
        <h1 className="text-2xl font-semibold">{t("copy.page.title")}</h1>
        <p className="text-sm text-surface-400">{t("copy.page.subtitle")}</p>
      </header>

      <SystemStatePanel />

      <StatsCard />

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">
          {t("copy.page.sections.trades")}
        </h2>
        <TradesTable />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">
          {t("copy.page.sections.signals")}
        </h2>
        <SignalsTable />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">
          {t("copy.page.sections.config")}
        </h2>
        <ConfigForm />
      </section>
    </div>
  );
}
