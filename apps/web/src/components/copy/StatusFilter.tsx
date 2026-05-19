import { useTranslation } from "react-i18next";

interface StatusFilterProps<T extends string> {
  value: T | "";
  options: readonly T[];
  onChange: (next: T | "") => void;
  /** i18n key prefix; option label is read from `${labelKeyPrefix}.${option}`. */
  labelKeyPrefix: string;
}

export function StatusFilter<T extends string>({
  value,
  options,
  onChange,
  labelKeyPrefix,
}: StatusFilterProps<T>) {
  const { t } = useTranslation();
  return (
    <>
      <label className="text-sm text-surface-400">{t("copy.common.statusLabel")}</label>
      <select
        className="rounded bg-surface-800 px-2 py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as T | "")}
      >
        <option value="">{t("copy.common.allStatuses")}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {t(`${labelKeyPrefix}.${opt}`)}
          </option>
        ))}
      </select>
    </>
  );
}
