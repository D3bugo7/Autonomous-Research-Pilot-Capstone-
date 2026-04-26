import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "dark" | "light";

type Settings = {
  theme: Theme;
  backendUrl: string;
};

type SettingsCtx = {
  settings: Settings;
  setTheme: (t: Theme) => void;
  setBackendUrl: (u: string) => void;
};

const KEY = "rp.settings";
const Ctx = createContext<SettingsCtx | null>(null);

const defaults: Settings = {
  theme: "dark",
  backendUrl: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
};

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) setSettings({ ...defaults, ...JSON.parse(raw) });
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings));
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings]);

  const value = useMemo(
    () => ({
      settings,
      setTheme: (theme: Theme) => setSettings((s) => ({ ...s, theme })),
      setBackendUrl: (backendUrl: string) => setSettings((s) => ({ ...s, backendUrl })),
    }),
    [settings]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be used within SettingsProvider");
  return v;
}