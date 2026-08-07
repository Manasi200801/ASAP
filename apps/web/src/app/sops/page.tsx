"use client";

import { LocaleSwitch } from "@/components/locale-switch";
import { KbSyncBar } from "@/components/sops/kb-sync-bar";
import { SopEditor } from "@/components/sops/sop-editor";
import { SopList } from "@/components/sops/sop-list";
import { SopUpload } from "@/components/sops/sop-upload";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLocale } from "@/lib/i18n";
import type { SopFile } from "@/lib/sop-types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export default function SopsPage() {
  const { locale, setLocale, t } = useLocale();
  const [files, setFiles] = useState<SopFile[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Same two effects as the run page: read the saved preference on mount rather
  // than at useState init so server and first client render agree, then mirror
  // it onto the document. Navigating between the two pages must not flip theme.
  useEffect(() => {
    const saved = window.localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  const refreshList = useCallback(async () => {
    const response = await fetch("/api/sops");
    const body = await response.json();
    if (!response.ok) {
      setLoadError(body.message ?? t("sopsLoadListFailed"));
      return;
    }
    setLoadError(null);
    setFiles(body.files);
  }, [t]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  async function selectFile(key: string) {
    setSelectedKey(key);
    const response = await fetch(`/api/sops/${encodeURIComponent(key)}`);
    const body = await response.json();
    if (!response.ok) {
      setLoadError(body.message ?? t("sopsLoadFileFailed"));
      return;
    }
    setLoadError(null);
    setContent(body.content);
  }

  async function save(key: string, nextContent: string) {
    const response = await fetch(`/api/sops/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: nextContent,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? t("sopsSaveFailed"));
    setUnsyncedCount((count) => count + 1);
    await refreshList();
  }

  async function upload(key: string, uploadContent: string) {
    await save(key, uploadContent);
    setSelectedKey(key);
    setContent(uploadContent);
  }

  return (
    <main className="min-h-screen bg-surface">
      {/* The run page's title bar, verbatim, so the language and the theme are
          changeable from here too - this was the one screen in the product where
          a German-speaking clerk lost both. */}
      <header className="flex flex-wrap items-center gap-5 border-outline-variant border-b bg-header px-8 py-4">
        <div className="font-semibold text-[21px] text-on-header uppercase tracking-[0.12em]">
          STRIKE <span className="text-primary">AP</span>
        </div>
        <div className="text-[15px] text-on-header/70">· {t("sopsTitle")}</div>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/"
            className="state-layer pressable rounded-full border border-on-header/30 px-4 py-2 font-medium text-[15px] text-on-header transition-colors hover:border-on-header/60 hover:bg-on-header/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-header"
          >
            {t("sopsBack")}
          </Link>
          <LocaleSwitch locale={locale} onChange={setLocale} />
          <ThemeToggle
            theme={theme}
            onToggle={() => setTheme((p) => (p === "dark" ? "light" : "dark"))}
            t={t}
          />
        </div>
      </header>

      <div className="mx-auto max-w-[1080px] px-5 pb-24">
        <section className="mt-10 overflow-hidden rounded-lg border border-outline-variant bg-surface">
          <div className="flex flex-col gap-4 px-4 py-5">
            <KbSyncBar unsyncedCount={unsyncedCount} onSynced={() => setUnsyncedCount(0)} t={t} />

            {loadError ? <p className="text-[15px] text-error">{loadError}</p> : null}

            <SopUpload existingKeys={files.map((f) => f.key)} onUpload={upload} t={t} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
              <SopList files={files} selectedKey={selectedKey} onSelect={selectFile} t={t} />
              {selectedKey ? (
                <SopEditor fileKey={selectedKey} content={content} onSave={save} t={t} />
              ) : (
                <p className="text-[15px] text-on-surface-variant">{t("sopsSelectHint")}</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
