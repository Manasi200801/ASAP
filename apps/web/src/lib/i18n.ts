"use client";

import de from "@/messages/de.json";
import en from "@/messages/en.json";
import { useCallback, useState } from "react";

export type Locale = "en" | "de";
export type MessageKey = keyof typeof en;

const MESSAGES: Record<Locale, Record<string, string>> = { en, de };

/**
 * One page, one language toggle - so a full i18n routing library would be
 * scaffolding for URLs we do not have. Two JSON files and a lookup is the whole
 * requirement. The locale also travels to the agent, which writes its
 * explanations in that language.
 */
export function useLocale() {
  const [locale, setLocale] = useState<Locale>("en");

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      const template = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
      if (!vars) return template;
      return Object.entries(vars).reduce(
        (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
        template,
      );
    },
    [locale],
  );

  return { locale, setLocale, t };
}

export type Translate = ReturnType<typeof useLocale>["t"];
