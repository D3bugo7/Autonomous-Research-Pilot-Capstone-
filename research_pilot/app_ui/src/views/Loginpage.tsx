import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth";

export default function LoginPage() {
  const [name, setName] = useState("");
  const { login, guest } = useAuth();
  const nav = useNavigate();

  const canLogin = useMemo(() => name.trim().length >= 2, [name]);

  return (
    <div className="min-h-screen relative overflow-hidden bg-slate-950 text-slate-100">
      {/* background glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-10 h-[420px] w-[420px] rounded-full bg-fuchsia-500/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-2xl border border-white/10 bg-white/5 shadow-lg" />
            <h1 className="text-3xl font-semibold tracking-tight">Research Pilot</h1>
            <p className="mt-2 text-sm text-slate-300">
              Upload PDFs, ask questions, and get citation-grounded answers.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
            <label className="text-xs font-medium text-slate-300">Name</label>
            <input
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-white/25"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Arnav"
            />

            <button
              className="mt-4 w-full rounded-2xl bg-indigo-400 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-indigo-400/20 disabled:opacity-50"
              disabled={!canLogin}
              onClick={() => {
                login(name.trim());
                nav("/app");
              }}
            >
              Continue
            </button>

            <button
              className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-semibold hover:bg-white/10"
              onClick={() => {
                guest();
                nav("/app");
              }}
            >
              Continue as Guest
            </button>

            <p className="mt-4 text-xs text-slate-400">
              MVP note: This is local-only login for now. Real auth can come later.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}