import { Link } from "react-router-dom";
import { useSettings } from "../state/settings";

export default function SettingsPage() {
  const { settings, setTheme, setBackendUrl } = useSettings();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <Link className="text-sm underline text-slate-300" to="/app">
            Back
          </Link>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="font-semibold">Theme</div>
            <div className="mt-2 flex gap-2">
              <button
                className={[
                  "px-3 py-2 rounded-xl border",
                  settings.theme === "dark"
                    ? "bg-indigo-400 text-slate-950 border-indigo-300/20"
                    : "bg-white/5 border-white/10",
                ].join(" ")}
                onClick={() => setTheme("dark")}
              >
                Dark
              </button>
              <button
                className={[
                  "px-3 py-2 rounded-xl border",
                  settings.theme === "light"
                    ? "bg-indigo-400 text-slate-950 border-indigo-300/20"
                    : "bg-white/5 border-white/10",
                ].join(" ")}
                onClick={() => setTheme("light")}
              >
                Light
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="font-semibold">Backend URL</div>
            <p className="text-xs text-slate-400 mt-1">Used for API calls.</p>
            <input
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none"
              value={settings.backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}