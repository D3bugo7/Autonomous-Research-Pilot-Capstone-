import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "dark" | "light";

type Settings = {
  theme: Theme;
  backendUrl: string;
  maxSources: number;        // how many source chunks to retrieve per query (1-12)
};

type SettingsCtx = {
  settings: Settings;
  setTheme: (t: Theme) => void;
  setBackendUrl: (u: string) => void;
  setMaxSources: (n: number) => void;
};

const KEY = "rp.settings";
const Ctx = createContext<SettingsCtx | null>(null);

const defaults: Settings = {
  theme: "dark",
  backendUrl: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
  maxSources: 8,
};

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);

  // Load from localStorage on mount
  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        setSettings({ ...defaults, ...JSON.parse(raw) });
      } catch { /* ignore */ }
    }
  }, []);

  // Persist to localStorage + apply dark class whenever settings change
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings));
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings]);

  const value = useMemo<SettingsCtx>(
    () => ({
      settings,
      setTheme: (theme) => setSettings((s) => ({ ...s, theme })),
      setBackendUrl: (backendUrl) => setSettings((s) => ({ ...s, backendUrl })),
      setMaxSources: (maxSources) => setSettings((s) => ({ ...s, maxSources })),
    }),
    [settings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be used within SettingsProvider");
  return v;
}
