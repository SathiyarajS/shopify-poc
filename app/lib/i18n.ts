import { useCallback } from "react";
import en from "../locales/en.json";

type Dictionary = Record<string, string>;

const dictionaries: Record<string, Dictionary> = {
  en,
};

function translate(locale: string, key: string, vars?: Record<string, string | number>): string {
  const dict = dictionaries[locale] ?? dictionaries.en;
  let template = dict[key] ?? key;
  if (vars) {
    for (const [token, value] of Object.entries(vars)) {
      template = template.replace(new RegExp(`{${token}}`, "g"), String(value));
    }
  }
  return template;
}

export function useI18n(locale = "en") {
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  return { t, locale };
}

export function formatSummary(summaryKey?: string, vars?: Record<string, string | number>, locale = "en"): string | undefined {
  if (!summaryKey) return undefined;
  return translate(locale, summaryKey, vars);
}
