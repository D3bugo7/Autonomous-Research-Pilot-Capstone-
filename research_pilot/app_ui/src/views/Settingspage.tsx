import { useState } from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../state/settings";
import { useAuth } from "../state/auth";

export default function SettingsPage() {
  const { settings, setTheme, setBackendUrl, setMaxSources } = useSettings();
  const { session } = useAuth();
  const [urlDraft, setUrlDraft] = useState(settings.backendUrl);
  const [cleared, setCleared] = useState(false);

  function handleUrlSave() {
    setBackendUrl(urlDraft.trim().replace(/\/+$/, ""));
  }

  function clearChatHistory() {
    // Remove all rp.chat.* keys from localStorage
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("rp.chat.")) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    setCleared(true);
    setTimeout(() => setCleared(false), 2500);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-white/10 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-2xl px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <Link
            to="/app"
            className="px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition"
          >
            ← Back to Research
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-8 space-y-5">

        {/* ── Interface ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Interface</h2>

          {/* Theme */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-slate-100">Theme</div>
                <p className="text-xs text-slate-400 mt-1">
                  Choose between dark and light mode. Dark is recommended for extended research sessions.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setTheme("dark")}
                  className={[
                    "px-4 py-2 rounded-xl text-sm font-medium border transition",
                    settings.theme === "dark"
                      ? "bg-indigo-500 text-white border-indigo-400/30"
                      : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10",
                  ].join(" ")}
                >
                  🌙 Dark
                </button>
                <button
                  onClick={() => setTheme("light")}
                  className={[
                    "px-4 py-2 rounded-xl text-sm font-medium border transition",
                    settings.theme === "light"
                      ? "bg-indigo-500 text-white border-indigo-400/30"
                      : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10",
                  ].join(" ")}
                >
                  ☀️ Light
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Research ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Research</h2>

          {/* Backend URL */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-3">
            <div className="font-medium text-slate-100">Backend URL</div>
            <p className="text-xs text-slate-400 mt-1 mb-3">
              The URL of the FastAPI backend. Change this if you're running the backend on a different host or port.
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/25 text-slate-100"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleUrlSave(); }}
                placeholder="http://127.0.0.1:8000"
              />
              <button
                onClick={handleUrlSave}
                className="px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-400 transition"
              >
                Save
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Current: <span className="text-slate-400">{settings.backendUrl}</span>
            </p>
          </div>

          {/* Max sources */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-slate-100">Sources per query</div>
                <p className="text-xs text-slate-400 mt-1">
                  How many source chunks to retrieve from your PDFs per research question.
                  More sources = richer answers but slower responses.
                </p>
              </div>
              <div className="text-2xl font-bold text-indigo-400 shrink-0 w-10 text-center">
                {settings.maxSources}
              </div>
            </div>
            <input
              type="range"
              min={3}
              max={12}
              step={1}
              value={settings.maxSources}
              onChange={(e) => setMaxSources(Number(e.target.value))}
              className="mt-4 w-full accent-indigo-500"
            />
            <div className="flex justify-between text-[11px] text-slate-500 mt-1">
              <span>3 — faster</span>
              <span>12 — more thorough</span>
            </div>
          </div>
        </section>

        {/* ── Data ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Data</h2>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="font-medium text-slate-100">Chat history</div>
            <p className="text-xs text-slate-400 mt-1 mb-4">
              Your conversation history is saved locally in your browser so it persists across page refreshes.
              Clear it here to start fresh.
            </p>
            <button
              onClick={clearChatHistory}
              className={[
                "px-4 py-2 rounded-xl text-sm font-medium border transition",
                cleared
                  ? "bg-green-500/20 border-green-400/30 text-green-300"
                  : "bg-red-500/10 border-red-400/20 text-red-300 hover:bg-red-500/20",
              ].join(" ")}
            >
              {cleared ? "✓ Chat history cleared" : "Clear chat history"}
            </button>

            {session?.username && (
              <p className="text-[11px] text-slate-600 mt-3">
                Saved under: <span className="text-slate-500">rp.chat.{session.username}</span>
              </p>
            )}
          </div>
        </section>

        {/* ── About ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">About</h2>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-100 text-lg">BumbleBeee</div>
                <div className="text-xs text-slate-400">Autonomous Research Pilot · Capstone 490</div>
              </div>
              <div className="text-3xl">🐝</div>
            </div>

            <div className="border-t border-white/10 pt-3 grid grid-cols-2 gap-y-2 text-xs">
              <span className="text-slate-500">Mode</span>
              <span className="text-slate-300">Multi-PDF citation-grounded RAG</span>

              <span className="text-slate-500">Backend</span>
              <span className="text-slate-300">FastAPI + LangGraph + Ollama</span>

              <span className="text-slate-500">Embeddings</span>
              <span className="text-slate-300">Local keyword index (TF)</span>

              <span className="text-slate-500">Frontend</span>
              <span className="text-slate-300">Vite + React + Tailwind</span>

              <span className="text-slate-500">Logged in as</span>
              <span className="text-slate-300">{session?.username ?? "—"}</span>
            </div>

            <p className="text-xs text-slate-500 pt-1">
              Upload PDFs → ask questions → get structured, citation-backed research answers with cross-document disagreement detection.
            </p>
          </div>
        </section>

      </div>
    </div>
  );
}
