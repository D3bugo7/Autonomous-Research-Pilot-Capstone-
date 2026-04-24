import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../state/auth";
import { useSettings } from "../state/settings";
import {
  listDocuments,
  postResearch,
  uploadPdf,
  deleteDocument,
  type ResearchResponse,
  type DocumentListItem,
} from "../lib/api";

type UploadedDoc = { id: string; name: string };

type SourceItem = { title?: string; snippet?: string; url?: string; page?: number };

type AssistantMeta = {
  plan?: string[];
  sources?: SourceItem[];
};

type ChatMsg =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      meta?: AssistantMeta;
    };

type AnalysisTab = "overview" | "sources" | "plan" | "conflicts";

function stripSlash(u: string) {
  return u.trim().replace(/\/+$/, "");
}

function summarizeConflicts(meta?: AssistantMeta) {
  if (!meta?.sources || meta.sources.length < 2) {
    return [
      "Not enough evidence blocks yet to compare documents for disagreements.",
      "Upload multiple PDFs and ask a comparative question to surface stronger cross-document analysis.",
    ];
  }

  const titles = Array.from(
    new Set(meta.sources.map((s, i) => s.title?.trim() || `Source ${i + 1}`)),
  ).slice(0, 3);

  return [
    `Potential comparison zone across ${titles.join(", ")}. The current backend response does not expose a dedicated conflict field yet, so this panel is ready for that final feature.`,
    "For now, use the sources and answer together to inspect whether the cited passages agree, qualify each other, or conflict.",
  ];
}

export default function ResearchApp() {
  const { session, logout } = useAuth();
  const { settings } = useSettings();

  const baseUrl = useMemo(() => stripSlash(settings.backendUrl), [settings.backendUrl]);
  const token = session?.token || "";

  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content:
        "Welcome to BumbleBeee. Upload PDFs, select the documents you want, and ask a research question grounded in your sources.",
      meta: {
        plan: [
          "Upload one or more PDFs.",
          "Select the documents you want included in this research pass.",
          "Ask a question and inspect the answer, sources, and reasoning on the right.",
        ],
      },
    },
  ]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<AnalysisTab>("overview");
  const [activeAssistantMessageIndex, setActiveAssistantMessageIndex] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasSelectedDocs = useMemo(() => selectedDocIds.size > 0, [selectedDocIds]);

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

  const assistantMessageEntries = useMemo(
    () =>
      messages
        .map((message, index) => ({ message, index }))
        .filter(
          (entry): entry is { message: Extract<ChatMsg, { role: "assistant" }>; index: number } =>
            entry.message.role === "assistant",
        ),
    [messages],
  );

  useEffect(() => {
    if (assistantMessageEntries.length === 0) {
      setActiveAssistantMessageIndex(0);
      return;
    }

    const lastWithMeta = [...assistantMessageEntries].reverse().find((entry) => entry.message.meta);
    setActiveAssistantMessageIndex((current) => {
      const stillExists = assistantMessageEntries.some((entry) => entry.index === current);
      if (stillExists) return current;
      return lastWithMeta?.index ?? assistantMessageEntries[assistantMessageEntries.length - 1].index;
    });
  }, [assistantMessageEntries]);

  const activeAssistantEntry =
    assistantMessageEntries.find((entry) => entry.index === activeAssistantMessageIndex) ??
    assistantMessageEntries[assistantMessageEntries.length - 1];

  const activeAssistantMeta = activeAssistantEntry?.message.meta;
  const conflictNotes = summarizeConflicts(activeAssistantMeta);

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
      setDocs((prev) => prev.filter((d) => d.id !== docId));
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
      for (const f of Array.from(files)) {
        if (f.type !== "application/pdf") continue;
        const resp = await uploadPdf(baseUrl, token, f);
        uploaded.push({ id: resp.doc_id, name: resp.filename || f.name });
      }

      if (uploaded.length === 0) {
        setErr("No PDF files detected.");
        return;
      }

      setDocs((prev) => [...uploaded, ...prev]);
      setSelectedDocIds((prev) => {
        const next = new Set(prev);
        for (const d of uploaded) next.add(d.id);
        return next;
      });

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: 'Uploaded ${uploaded.length} PDF${uploaded.length > 1 ? "s" : ""}. You can now run cross-document research over the selected set."',
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
            : "Done. (Backend didn’t return an answer field yet — inspect the analysis panel on the right.)";

      let newIndex = -1;
      setMessages((m) => {
        newIndex = m.length;
        return [
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
        ];
      });
      if (newIndex >= 0) setActiveAssistantMessageIndex(newIndex);
      setActiveAnalysisTab(resp.sources?.length ? "sources" : resp.plan?.length ? "plan" : "overview");
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

  const analysisTabButton = (tab: AnalysisTab, label: string) => (
    <button
      type="button"
      onClick={() => setActiveAnalysisTab(tab)}
      className={[
        "rounded-xl px-3 py-2 text-xs font-medium transition",
        activeAnalysisTab === tab
          ? "bg-amber-400 text-slate-950"
          : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto max-w-[1500px] px-6 py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">BumbleBeee Research Assistant</h1>
            <p className="text-sm text-slate-400">
              Multi-PDF evidence-based research with grounded answers, source tracing, and a final-ready interface.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
              {selectedDocIds.size} selected · {docs.length} uploaded
            </div>
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

      <div className="mx-auto max-w-[1500px] px-6 py-6 grid grid-cols-12 gap-5">
        <aside className="col-span-12 xl:col-span-3">
          <div
            className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 backdrop-blur"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleFiles(e.dataTransfer.files);
            }}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">Documents</h2>
                <p className="text-xs text-slate-400">
                  {uploading ? "Uploading PDFs…" : loadingDocs ? "Loading your library…" : "Drag, drop, or upload PDFs"}
                </p>
              </div>

              <>
                <button
                  className="text-xs px-3 py-2 rounded-xl bg-indigo-500 text-white font-medium hover:bg-indigo-400 transition disabled:opacity-50"
                  disabled={uploading || loadingDocs}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
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
              </>
            </div>

            {err ? (
              <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {err}
              </div>
            ) : null}

            <div className="mb-4 rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-xs text-slate-400">
              Select the PDFs you want included in the current research pass. This keeps the final product behavior clear during demos.
            </div>

            {docs.length > 0 ? (
              <div className="mb-4 flex gap-2">
                <button
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                  onClick={selectAll}
                  type="button"
                >
                  Select all
                </button>
                <button
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
                  onClick={clearSelection}
                  type="button"
                >
                  Clear
                </button>
              </div>
            ) : null}

            <div className="space-y-2 max-h-[64vh] overflow-auto pr-1">
              {docs.length === 0 ? (
                <div className="text-sm text-slate-400 border border-dashed border-white/15 rounded-2xl p-4">
                  No PDFs yet. Upload one to begin.
                </div>
              ) : (
                docs.map((d) => {
                  const checked = selectedDocIds.has(d.id);
                  return (
                    <div
                      key={d.id}
                      className={[
                        "rounded-2xl border px-3 py-3 transition",
                        checked
                          ? "border-indigo-400/30 bg-indigo-500/10"
                          : "border-white/10 bg-black/20 hover:bg-white/5",
                      ].join(" ")}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => toggleDoc(d.id)}
                          className="flex flex-1 items-start gap-3 text-left"
                          title={d.name}
                        >
                          <span
                            className={[
                              "mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center text-[11px] font-bold",
                              checked
                                ? "border-indigo-300/30 bg-indigo-400 text-slate-950"
                                : "border-white/20 bg-black/30 text-transparent",
                            ].join(" ")}
                          >
                            ✓
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-100">{d.name}</div>
                            <div className="mt-1 text-xs text-slate-400">
                              {checked ? "Included in current research" : "Not included"}
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDelete(d.id)}
                          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
                          title="Delete PDF"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-4 text-xs text-slate-500">
              Backend: <span className="text-slate-400">{baseUrl}</span>
            </div>
          </div>
        </aside>

        <section className="col-span-12 xl:col-span-6">
          <div className="flex h-[78vh] flex-col rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">Research Chat</h2>
                <p className="text-xs text-slate-400">
                  Ask comparative questions across the selected PDFs. Click any assistant answer to inspect its evidence on the right.
                </p>
              </div>
              <button
                type="button"
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10"
              >
                Export Summary
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-auto pr-2">
              {messages.map((m, idx) => {
                const isActiveAssistant = m.role === "assistant" && idx === activeAssistantMessageIndex;
                return (
                  <div key={idx} className="flex flex-col gap-2">
                    <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <button
                        type="button"
                        disabled={m.role !== "assistant"}
                        onClick={() => {
                          if (m.role === "assistant") setActiveAssistantMessageIndex(idx);
                        }}
                        className={[
                          "max-w-3xl rounded-3xl px-5 py-4 text-left text-sm leading-7 shadow-md transition",
                          m.role === "user"
                            ? "cursor-default bg-indigo-500 text-white"
                            : [
                                "border whitespace-pre-wrap",
                                isActiveAssistant
                                  ? "border-amber-400/60 bg-slate-800 ring-1 ring-amber-400/40"
                                  : "border-white/10 bg-slate-800 hover:border-white/20",
                              ].join(" "),
                        ].join(" ")}
                      >
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {m.role === "user" ? "You" : "BumbleBeee"}
                        </div>
                        <div className={m.role === "user" ? "text-white" : "text-slate-100"}>{m.content}</div>
                      </button>
                    </div>
                  </div>
                );
              })}

              {busy ? (
                <div className="flex justify-start">
                  <div className="max-w-3xl rounded-3xl border border-white/10 bg-slate-800 px-5 py-4 text-sm text-slate-300">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      BumbleBeee
                    </div>
                    Analyzing the selected documents and assembling grounded evidence…
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-3xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-col gap-3 md:flex-row">
                <input
                  className="flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-white/25 disabled:opacity-60"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    hasSelectedDocs
                      ? "Ask about themes, agreements, disagreements, evidence, or summaries across your PDFs…"
                      : "Select a PDF on the left to begin…"
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
                  className="rounded-2xl bg-amber-400 text-slate-950 font-semibold px-5 py-3 text-sm disabled:opacity-50"
                  onClick={() => void send()}
                  disabled={busy || input.trim().length < 2 || !hasSelectedDocs}
                  type="button"
                >
                  {busy ? "Working…" : "Send"}
                </button>
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Selected PDFs: {selectedDocIds.size} · Uploaded PDFs: {docs.length}
              </div>
            </div>
          </div>
        </section>

        <aside className="col-span-12 xl:col-span-3">
          <div className="flex h-[78vh] flex-col rounded-3xl border border-white/10 bg-slate-900/70 p-5 backdrop-blur">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-white">Analysis Panel</h2>
              <p className="text-xs text-slate-400">
                Persistent evidence and reasoning view for the selected assistant response.
              </p>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {analysisTabButton("overview", "Overview")}
              {analysisTabButton("sources", `Sources${activeAssistantMeta?.sources?.length ? ` (${activeAssistantMeta.sources.length})` : ""}`)}
              {analysisTabButton("plan", `Plan${activeAssistantMeta?.plan?.length ? ` (${activeAssistantMeta.plan.length})` : ""}`)}
              {analysisTabButton("conflicts", "Conflicts")}
            </div>

            <div className="flex-1 overflow-auto pr-1">
              {activeAssistantEntry ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Selected answer
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-200 whitespace-pre-wrap">
                      {activeAssistantEntry.message.content}
                    </div>
                  </div>

                  {activeAnalysisTab === "overview" ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-sm font-semibold text-white">Response Snapshot</div>
                        <div className="mt-2 text-sm text-slate-300 leading-6">
                          {activeAssistantMeta?.sources?.length
                            ? `This answer is backed by ${activeAssistantMeta.sources.length} cited source block${activeAssistantMeta.sources.length > 1 ? "s" : ""}.`
                            : "This answer currently has no visible source blocks from the backend."}
                        </div>
                        <div className="mt-2 text-sm text-slate-300 leading-6">
                          {activeAssistantMeta?.plan?.length
                            ? `A ${activeAssistantMeta.plan.length}-step reasoning plan is available for inspection.`
                            : "No explicit plan was returned for this response."}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                        <div className="text-sm font-semibold text-amber-200">Final-product direction</div>
                        <div className="mt-2 text-sm text-amber-100/90 leading-6">
                          This panel is now ready for richer backend features like disagreement detection, confidence summaries, and export-ready structured findings.
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeAnalysisTab === "sources" ? (
                    activeAssistantMeta?.sources?.length ? (
                      <div className="space-y-3">
                        {activeAssistantMeta.sources.map((s, i) => (
                          <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="text-sm font-semibold text-white">
                              {s.title || `Source ${i + 1}`}
                              {typeof s.page === "number" ? (
                                <span className="text-slate-400"> · p.{s.page}</span>
                              ) : null}
                            </div>
                            <div className="mt-2 text-sm leading-6 text-slate-300 whitespace-pre-wrap">
                              {s.snippet || "No snippet provided."}
                            </div>
                            {s.url ? (
                              <div className="mt-3 break-all text-xs text-slate-400">{s.url}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                        No sources returned for this answer yet.
                      </div>
                    )
                  ) : null}

                  {activeAnalysisTab === "plan" ? (
                    activeAssistantMeta?.plan?.length ? (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-300">
                          {activeAssistantMeta.plan.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                        No reasoning plan returned for this answer yet.
                      </div>
                    )
                  ) : null}

                  {activeAnalysisTab === "conflicts" ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-sm font-semibold text-white">Cross-document disagreement view</div>
                        <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
                          {conflictNotes.map((note, index) => (
                            <p key={index}>{note}</p>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                        Once your backend returns explicit disagreement data, this tab can show “Document A says X / Document B says Y” cards without changing the overall layout again.
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                  No assistant response selected yet.
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
