import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../state/auth";
import { useSettings } from "../state/settings";
import { listDocuments, postResearch, uploadPdf, deleteDocument, type ResearchResponse, type DocumentListItem } from "../lib/api";
type UploadedDoc = { id: string; name: string };

type ChatMsg =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      meta?: {
        plan?: string[];
        sources?: { title?: string; snippet?: string; url?: string; page?: number }[];
      };
    };

function stripSlash(u: string) {
  return u.trim().replace(/\/+$/, "");
}

export default function ResearchApp() {
  const { session, logout } = useAuth();
  const { settings } = useSettings();

  const baseUrl = useMemo(() => stripSlash(settings.backendUrl), [settings.backendUrl]);
  const token = session?.token || "";

  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: "Upload PDFs on the left, then ask a question about them." },
  ]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasSelectedDocs = useMemo(() => selectedDocIds.size > 0, [selectedDocIds]);

  // Load user's uploaded docs on first mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) return;
      setLoadingDocs(true);
      setErr(null);
      try {
        const list: DocumentListItem[] = await listDocuments(baseUrl, token);
        if (cancelled) return;

        const mapped: UploadedDoc[] = list.map((d) => ({ id: d.doc_id, name: d.filename }));
        setDocs(mapped);

        // Default: select all docs
        setSelectedDocIds(new Set(mapped.map((d) => d.id)));
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message ?? "Failed to load documents.");
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token]);

  function toggleDoc(id: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedDocIds(new Set(docs.map((d) => d.id)));
  }

  function clearSelection() {
    setSelectedDocIds(new Set());
  }
  async function handleDelete(docId: string) {
    if (!token) return;
  
    const doc = docs.find((d) => d.id === docId);
    const ok = window.confirm(`Delete "${doc?.name ?? "this PDF"}"? This cannot be undone.`);
    if (!ok) return;
  
    setErr(null);
    try {
      await deleteDocument(baseUrl, token, docId);
  
      // remove from UI list
      setDocs((prev) => prev.filter((d) => d.id !== docId));
  
      // remove from selection
      setSelectedDocIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
  
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Deleted "${doc?.name ?? "PDF"}".` },
      ]);
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed.");
    }
  }
  
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!token) {
      setErr("Not authenticated. Please login again.");
      return;
    }

    setErr(null);
    setUploading(true);

    try {
      const uploaded: UploadedDoc[] = [];

      // upload sequentially (safe for MVP)
      for (const f of Array.from(files)) {
        if (f.type !== "application/pdf") continue;

        const resp = await uploadPdf(baseUrl, token, f);
        uploaded.push({
          id: resp.doc_id,
          name: resp.filename || f.name,
        });
      }

      if (uploaded.length === 0) {
        setErr("No PDF files detected.");
        return;
      }

      setDocs((prev) => [...uploaded, ...prev]);

      // auto-select newly uploaded docs
      setSelectedDocIds((prev) => {
        const next = new Set(prev);
        for (const d of uploaded) next.add(d.id);
        return next;
      });

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Uploaded ${uploaded.length} PDF${uploaded.length > 1 ? "s" : ""}. Ask a question when you’re ready.`,
        },
      ]);
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    if (!token) {
      setErr("Not authenticated. Please login again.");
      return;
    }
    if (selectedDocIds.size === 0) {
      setErr("Select at least one uploaded PDF before asking a question.");
      return;
    }

    setErr(null);
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setBusy(true);

    try {
      const resp: ResearchResponse = await postResearch(baseUrl, token, {
        question: q,
        doc_ids: Array.from(selectedDocIds),
      });

      const main =
        typeof resp.answer === "string"
        ? resp.answer.trim()
        : resp.answer != null
          ? JSON.stringify(resp.answer, null, 2)
          : "Done. (Backend didn’t return an `answer` field yet — showing plan/sources below.)";

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: main,
          meta: {
            plan: resp.plan,
            sources: resp.sources?.map((s) => ({
              title: s.title,
              snippet: s.snippet,
              url: s.url,
              page: s.page,
            })),
          },
        },
      ]);
    } catch (e: any) {
      setErr(e?.message ?? "Research request failed.");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "I hit an error calling the backend. Check Settings → Backend URL and backend logs.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Research Pilot</h1>
            <p className="text-xs text-slate-400">Only searches PDFs you uploaded (per user).</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{session?.username}</span>
            <Link
              to="/settings"
              className="px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 hover:bg-white/10"
            >
              Settings
            </Link>
            <button
              className="px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 hover:bg-white/10"
              onClick={logout}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="mx-auto max-w-6xl px-6 py-5 grid grid-cols-12 gap-4">
        {/* Sidebar */}
        <aside className="col-span-12 md:col-span-4 lg:col-span-3">
          <div
            className="rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur p-5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleFiles(e.dataTransfer.files);
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Your PDFs</h2>
                <p className="text-xs text-slate-400">
                  {uploading ? "Uploading…" : loadingDocs ? "Loading…" : "Drag & drop or upload"}
                </p>
              </div>

              <button
                className="text-xs px-3 py-2 rounded-xl bg-indigo-500 text-white font-medium hover:bg-indigo-400 transition disabled:opacity-50"
                disabled={uploading || loadingDocs}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "…" : "Upload"}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </div>
            {err && (
              <div className="mb-3 text-xs rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-red-200">
                {err}
              </div>
            )}

            {docs.length > 0 && (
              <div className="mb-3 flex gap-2">
                <button
                  className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                  onClick={selectAll}
                  type="button"
                >
                  Select all
                </button>
                <button
                  className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                  onClick={clearSelection}
                  type="button"
                >
                  Clear
                </button>
              </div>
            )}

            <div className="space-y-2">
              {docs.length === 0 ? (
                <div className="text-sm text-slate-400 border border-dashed border-white/15 rounded-2xl p-4">
                  No PDFs yet. Upload one to begin.
                </div>
              ) : (
                docs.map((d) => {
                  const checked = selectedDocIds.has(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleDoc(d.id)}
                      className={[
                        "w-full text-left flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition",
                        checked
                          ? "border-indigo-400/30 bg-indigo-500/10"
                          : "border-white/10 bg-black/20 hover:bg-white/5",
                      ].join(" ")}
                      title={d.name}
                    >
                      <span
                        className={[
                          "h-4 w-4 rounded border flex items-center justify-center text-[10px]",
                          checked
                            ? "border-indigo-300/30 bg-indigo-400 text-slate-950"
                            : "border-white/20 bg-black/30 text-transparent",
                        ].join(" ")}
                      >
                        ✓
                      </span>
                      <span className="truncate flex-1">{d.name}</span>
                      <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation(); // IMPORTANT: don't toggle selection when deleting
                        void handleDelete(d.id);
                      }}
                      className="ml-2 px-2 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-xs"
                      title="Delete PDF"
                      >
                        🗑
                      </button>
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-4 text-xs text-slate-500">
              Backend: <span className="text-slate-400">{baseUrl}</span>
            </div>
          </div>
        </aside>

        {/* Chat */}
        <section className="col-span-12 md:col-span-8 lg:col-span-9">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 flex flex-col h-[75vh]">
            <div className="flex-1 overflow-auto pr-2 space-y-6">
              {messages.map((m, idx) => (
                <div key={idx} className="flex flex-col gap-2">
                  <div className="flex">
                    <div
                      className={[
                        "max-w-3xl px-5 py-4 rounded-3xl text-sm leading-relaxed shadow-md transition-all",
                        m.role === "user"
                        ? "ml-auto bg-indigo-500 text-white"
                        : "bg-slate-800 text-slate-100 border border-white/10 whitespace-pre-wrap"
                      ].join(" ")}
                    >
                      {m.content}
                    </div>
                  </div>

                  {"meta" in m && m.meta && (m.meta.plan?.length || m.meta.sources?.length) ? (
                    <div className="ml-0 md:ml-2 space-y-2">
                      {m.meta.plan?.length ? (
                        <details className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                          <summary className="cursor-pointer text-xs text-slate-300 font-semibold">
                            Plan ({m.meta.plan.length})
                          </summary>
                          <ol className="mt-2 list-decimal pl-5 text-xs text-slate-300 space-y-1">
                            {m.meta.plan.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ol>
                        </details>
                      ) : null}

                      {m.meta.sources?.length ? (
                        <details className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                          <summary className="cursor-pointer text-xs text-slate-300 font-semibold">
                            Sources ({m.meta.sources.length})
                          </summary>
                          <div className="mt-2 space-y-2">
                            {m.meta.sources.map((s, i) => (
                              <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                <div className="text-xs font-semibold text-slate-200">
                                  {s.title || `Source ${i + 1}`}
                                  {typeof s.page === "number" ? (
                                    <span className="text-slate-400"> · p.{s.page}</span>
                                  ) : null}
                                </div>
                                {s.snippet ? (
                                  <div className="mt-1 text-xs text-slate-300 whitespace-pre-wrap">
                                    {s.snippet}
                                  </div>
                                ) : (
                                  <div className="mt-1 text-xs text-slate-500">No snippet.</div>
                                )}
                                {s.url ? (
                                  <div className="mt-2 text-xs text-slate-400 break-all">{s.url}</div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <input
                className="flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-white/25 disabled:opacity-60"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  hasSelectedDocs ? "Ask about your selected PDFs…" : "Select a PDF on the left…"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                disabled={busy}
              />
              <button
                className="rounded-2xl bg-indigo-400 text-slate-950 font-semibold px-5 py-3 text-sm disabled:opacity-50"
                onClick={() => void send()}
                disabled={busy || input.trim().length < 2 || !hasSelectedDocs}
              >
                {busy ? "…" : "Send"}
              </button>
            </div>

            <div className="mt-2 text-xs text-slate-400">
              Selected PDFs: {selectedDocIds.size} · Uploaded PDFs: {docs.length}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}