import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "../state/settings";
import { useAuth } from "../state/auth";
import { loginUser, registerUser } from "../lib/api";

export default function LoginPage() {
  const nav = useNavigate();
  const { settings } = useSettings();
  const { setSession } = useAuth();

  const baseUrl = settings.backendUrl;

  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const u = username.trim();
      const p = password;

      const resp =
        mode === "login" ? await loginUser(baseUrl, u, p) : await registerUser(baseUrl, u, p);

      setSession({ username: resp.username, token: resp.access_token });
      nav("/app");
    } catch (e: any) {
      setErr(e?.message ?? "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-10 h-[420px] w-[420px] rounded-full bg-fuchsia-500/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-2xl border border-white/10 bg-white/5 shadow-lg" />
            <h1 className="text-3xl font-semibold tracking-tight">Research Pilot</h1>
            <p className="mt-2 text-sm text-slate-300">Upload PDFs and ask questions about them.</p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
            <div className="flex gap-2 mb-4">
              <button
                className={[
                  "flex-1 rounded-2xl py-2 text-sm font-semibold border",
                  mode === "login"
                    ? "bg-indigo-400 text-slate-950 border-indigo-300/20"
                    : "bg-white/5 border-white/10 hover:bg-white/10",
                ].join(" ")}
                onClick={() => setMode("login")}
              >
                Login
              </button>
              <button
                className={[
                  "flex-1 rounded-2xl py-2 text-sm font-semibold border",
                  mode === "register"
                    ? "bg-indigo-400 text-slate-950 border-indigo-300/20"
                    : "bg-white/5 border-white/10 hover:bg-white/10",
                ].join(" ")}
                onClick={() => setMode("register")}
              >
                Register
              </button>
            </div>

            <label className="text-xs font-medium text-slate-300">Username</label>
            <input
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-white/25"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="arnav"
            />

            <label className="mt-4 block text-xs font-medium text-slate-300">Password</label>
            <input
              type="password"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-white/25"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            {err && (
              <div className="mt-4 text-xs rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-red-200">
                {err}
              </div>
            )}

            <button
              className="mt-4 w-full rounded-2xl bg-indigo-400 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-indigo-400/20 disabled:opacity-50"
              disabled={busy || username.trim().length < 3 || password.length < 6}
              onClick={submit}
            >
              {busy ? "…" : mode === "login" ? "Login" : "Create account"}
            </button>

            <p className="mt-4 text-xs text-slate-400">
              Backend: <span className="text-slate-300">{baseUrl}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}