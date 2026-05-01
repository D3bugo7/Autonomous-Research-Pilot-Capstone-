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
  disagreements?: string[];
};

type ChatMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; meta?: AssistantMeta };

type AnalysisTab = "overview" | "sources" | "plan" | "conflicts";

// ─────────────────────────────────────────────
// Session type
// ─────────────────────────────────────────────
type Session = {
  id: string;
  title: string;
  createdAt: number;
  messages: ChatMsg[];
};

function stripSlash(u: string) {
  return u.trim().replace(/\/+$/, "");
}

// ─────────────────────────────────────────────
// PDF Export helper
// ─────────────────────────────────────────────
function buildExportHTML(
  question: string,
  answer: string,
  meta: AssistantMeta | undefined,
): string {
  const now = new Date().toLocaleString();
  const sources = meta?.sources ?? [];
  const plan = meta?.plan ?? [];
  const disagreements = meta?.disagreements ?? [];

  const formatAnswer = (text: string) => {
    const lines = text.split("\n");
    const out: string[] = [];
    let inList = false;

    for (const raw of lines) {
      const line = raw
        .replace(/^## (.+)$/, "<h2>$1</h2>")
        .replace(/^### (.+)$/, "<h3>$1</h3>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

      if (/^\- (.+)$/.test(raw)) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push(`<li>${raw.replace(/^\- /, "")}</li>`);
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        if (line.trim()) out.push(`<p>${line}</p>`);
      }
    }
    if (inList) out.push("</ul>");
    return out.join("\n");
  };

  const sourceRows = sources
    .map(
      (s, i) => `
      <div class="source">
        <div class="source-title">${i + 1}. ${s.title ?? `Source ${i + 1}`}${
          typeof s.page === "number" ? ` &middot; p.${s.page}` : ""
        }</div>
        ${s.snippet ? `<div class="source-snippet">${s.snippet}</div>` : ""}
      </div>`,
    )
    .join("");

  const planItems = plan.map((step) => `<li>${step}</li>`).join("");
  const disagreementItems =
    disagreements.length > 0
      ? disagreements.map((d) => `<li>${d}</li>`).join("")
      : "<li>No explicit cross-document disagreements detected.</li>";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>BumbleBeee Research Report</title>
  <style>
    body{font-family:Georgia,serif;max-width:820px;margin:40px auto;color:#111;line-height:1.75;padding:0 24px}
    h1{font-size:1.55rem;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:4px}
    h2{font-size:1.15rem;margin-top:32px;color:#1a1a1a;border-bottom:1px solid #ddd;padding-bottom:4px}
    h3{font-size:1rem;color:#444;margin-top:18px}
    .meta{color:#888;font-size:.82rem;margin-bottom:24px}
    .question-box{background:#f6f6f6;border-left:4px solid #444;padding:12px 18px;margin:20px 0;font-style:italic;font-size:.95rem}
    .answer p{margin:10px 0}
    .source{border:1px solid #ddd;padding:12px 14px;margin:8px 0;border-radius:5px}
    .source-title{font-weight:700;font-size:.88rem}
    .source-snippet{font-size:.83rem;color:#555;margin-top:6px;line-height:1.55}
    ol,ul{padding-left:22px}
    li{margin:6px 0;font-size:.93rem}
    .footer{margin-top:48px;border-top:1px solid #ddd;padding-top:12px;font-size:.78rem;color:#aaa}
    @media print{body{margin:20px}}
  </style>
</head>
<body>
  <h1>BumbleBeee Research Report</h1>
  <div class="meta">Generated: ${now}</div>
  <div class="question-box">${question}</div>
  <div class="answer">${formatAnswer(answer)}</div>
  ${plan.length ? `<h2>Reasoning Plan</h2><ol>${planItems}</ol>` : ""}
  ${sources.length ? `<h2>Sources (${sources.length})</h2>${sourceRows}` : ""}
  <h2>Cross-document Disagreements</h2>
  <ul>${disagreementItems}</ul>
  <div class="footer">BumbleBeee Autonomous Research Pilot &mdash; ${now}</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// Session storage helpers
// ─────────────────────────────────────────────
const WELCOME_MSG: ChatMsg = {
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
};

function generateId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function sessionsKey(username: string) {
  return `rp.sessions.${username}`;
}

// Trim stored snippets to keep localStorage usage reasonable
function sanitizeForStorage(msgs: ChatMsg[]): ChatMsg[] {
  return msgs.map((m) => {
    if (m.role !== "assistant" || !m.meta?.sources) return m;
    return {
      ...m,
      meta: {
        ...m.meta,
        sources: m.meta.sources.map((s) => ({
          ...s,
          snippet: s.snippet ? s.snippet.slice(0, 400) : s.snippet,
        })),
      },
    };
  });
}

function loadSessions(username: string): Session[] {
  // Try new multi-session format first
  try {
    const raw = localStorage.getItem(sessionsKey(username));
    if (raw) {
      const parsed = JSON.parse(raw) as Session[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }

  // Migrate from old single-chat format (rp.chat.{username})
  const oldKey = `rp.chat.${username}`;
  try {
    const oldRaw = localStorage.getItem(oldKey);
    if (oldRaw) {
      const oldMsgs = JSON.parse(oldRaw) as ChatMsg[];
      if (Array.isArray(oldMsgs) && oldMsgs.length > 1) {
        const firstUser = oldMsgs.find((m) => m.role === "user");
        const migrated: Session = {
          id: generateId(),
          title: firstUser ? firstUser.content.slice(0, 50) : "Previous session",
          createdAt: Date.now(),
          messages: oldMsgs,
        };
        return [migrated];
      }
    }
  } catch { /* ignore */ }

  return [];
}

function saveSessions(username: string, sessions: Session[]): void {
  try {
    const sanitized = sessions.map((s) => ({
      ...s,
      messages: sanitizeForStorage(s.messages),
    }));
    localStorage.setItem(sessionsKey(username), JSON.stringify(sanitized));
  } catch { /* quota exceeded — silently skip */ }
}

function makeNewSession(): Session {
  return {
    id: generateId(),
    title: "New chat",
    createdAt: Date.now(),
    messages: [WELCOME_MSG],
  };
}

function relativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < day) return "Today";
  if (diff < 2 * day) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export default function ResearchApp() {
  const { session, logout } = useAuth();
  const { settings } = useSettings();

  const baseUrl = useMemo(() => stripSlash(settings.backendUrl), [settings.backendUrl]);
  const token = session?.token || "";

  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME_MSG]);

  // Session state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<AnalysisTab>("overview");
  const [activeAssistantMessageIndex, setActiveAssistantMessageIndex] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const hasSelectedDocs = useMemo(() => selectedDocIds.size > 0, [selectedDocIds]);

  // ── Load sessions on mount ──
  useEffect(() => {
    if (!session?.username) return;
    const loaded = loadSessions(session.username);
    if (loaded.length > 0) {
      setSessions(loaded);
      setActiveSessionId(loaded[0].id);
      setMessages(loaded[0].messages);
    } else {
      const fresh = makeNewSession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
      setMessages([WELCOME_MSG]);
    }
  }, [session?.username]);

  // ── Persist active session messages on every change ──
  useEffect(() => {
    if (!session?.username || !activeSessionId || messages.length <= 1) return;
    setSessions((prev) => {
      const next = prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const firstUser = messages.find((m) => m.role === "user");
        const title = firstUser ? firstUser.content.slice(0, 55) : s.title;
        return { ...s, title, messages };
      });
      saveSessions(session.username!, next);
      return next;
    });
  }, [messages, session?.username, activeSessionId]);

  // Auto-scroll to latest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Load documents on mount
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
    return () => { cancelled = true; };
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
    const lastWithMeta = [...assistantMessageEntries].reverse().find((e) => e.message.meta);
    setActiveAssistantMessageIndex((current) => {
      const stillExists = assistantMessageEntries.some((e) => e.index === current);
      if (stillExists) return current;
      return lastWithMeta?.index ?? assistantMessageEntries[assistantMessageEntries.length - 1].index;
    });
  }, [assistantMessageEntries]);

  const activeAssistantEntry =
    assistantMessageEntries.find((e) => e.index === activeAssistantMessageIndex) ??
    assistantMessageEntries[assistantMessageEntries.length - 1];

  const activeAssistantMeta = activeAssistantEntry?.message.meta;

  // ─────────────────────────────────────────────
  // Session management
  // ─────────────────────────────────────────────
  function startNewChat() {
    const fresh = makeNewSession();
    setSessions((prev) => {
      const updated = [fresh, ...prev];
      if (session?.username) saveSessions(session.username, updated);
      return updated;
    });
    setActiveSessionId(fresh.id);
    setMessages([WELCOME_MSG]);
    setActiveAssistantMessageIndex(0);
    setActiveAnalysisTab("overview");
    setInput("");
    setErr(null);
  }

  function switchSession(sessionId: string) {
    if (sessionId === activeSessionId) return;
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    setActiveSessionId(sessionId);
    setMessages(target.messages);
    setActiveAssistantMessageIndex(0);
    setActiveAnalysisTab("overview");
    setInput("");
    setErr(null);
  }

  function deleteSession(sessionId: string) {
    const remaining = sessions.filter((s) => s.id !== sessionId);

    if (sessionId === activeSessionId) {
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id);
        setMessages(remaining[0].messages);
      } else {
        const fresh = makeNewSession();
        remaining.push(fresh);
        setActiveSessionId(fresh.id);
        setMessages([WELCOME_MSG]);
      }
      setActiveAssistantMessageIndex(0);
      setActiveAnalysisTab("overview");
      setInput("");
      setErr(null);
    }

    setSessions(remaining);
    if (session?.username) saveSessions(session.username, remaining);
  }

  // ── Export ──
  function exportToPDF(msgIndex?: number) {
    const idx = msgIndex ?? activeAssistantEntry?.index;
    if (idx === undefined) return;

    const entry = assistantMessageEntries.find((e) => e.index === idx);
    if (!entry) return;

    const precedingMsg = idx > 0 ? messages[idx - 1] : null;
    const question = precedingMsg?.role === "user" ? precedingMsg.content : "Research Report";
    const html = buildExportHTML(question, entry.message.content, entry.message.meta);
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 500);
    }
  }

  // ── Document helpers ──
  function toggleDoc(id: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAll() { setSelectedDocIds(new Set(docs.map((d) => d.id))); }
  function clearSelection() { setSelectedDocIds(new Set()); }

  async function handleDelete(docId: string) {
    if (!token) return;
    const doc = docs.find((d) => d.id === docId);
    if (!window.confirm(`Delete "${doc?.name ?? "this PDF"}"? This cannot be undone.`)) return;
    setErr(null);
    try {
      await deleteDocument(baseUrl, token, docId);
      setDocs((prev) => prev.filter((d) => d.id !== docId));
      setSelectedDocIds((prev) => { const next = new Set(prev); next.delete(docId); return next; });
      setMessages((m) => [...m, { role: "assistant", content: `Deleted "${doc?.name ?? "PDF"}".` }]);
    } catch (e: any) { setErr(e?.message ?? "Delete failed."); }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!token) { setErr("Not authenticated. Please login again."); return; }
    setErr(null);
    setUploading(true);
    try {
      const uploaded: UploadedDoc[] = [];
      for (const f of Array.from(files)) {
        if (f.type !== "application/pdf") continue;
        const resp = await uploadPdf(baseUrl, token, f);
        uploaded.push({ id: resp.doc_id, name: resp.filename || f.name });
      }
      if (uploaded.length === 0) { setErr("No PDF files detected."); return; }
      setDocs((prev) => [...uploaded, ...prev]);
      setSelectedDocIds((prev) => {
        const next = new Set(prev);
        for (const d of uploaded) next.add(d.id);
        return next;
      });
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Uploaded ${uploaded.length} PDF${uploaded.length > 1 ? "s" : ""}. You can now run cross-document research over the selected set.` },
      ]);
    } catch (e: any) { setErr(e?.message ?? "Upload failed."); }
    finally { setUploading(false); }
  }

  // ── Send research request ──
  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    if (!token) { setErr("Not authenticated. Please login again."); return; }
    if (selectedDocIds.size === 0) { setErr("Select at least one uploaded PDF before asking a question."); return; }

    setErr(null);
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setBusy(true);

    try {
      const resp: ResearchResponse = await postResearch(baseUrl, token, {
        question: q,
        doc_ids: Array.from(selectedDocIds),
        max_sources: settings.maxSources,
      });

      const main =
        typeof resp.answer === "string"
          ? resp.answer.trim()
          : resp.answer != null
            ? JSON.stringify(resp.answer, null, 2)
            : "Done. (Backend didn't return an answer field yet.)";

      const rawDisagreements: unknown[] = Array.isArray(resp.disagreements) ? resp.disagreements : [];
      const disagreements: string[] = rawDisagreements.map((d) =>
        typeof d === "string" ? d : JSON.stringify(d),
      );

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
              sources: resp.sources?.map((s) => ({ title: s.title, snippet: s.snippet, url: s.url, page: s.page })),
              disagreements,
            },
          },
        ];
      });

      if (newIndex >= 0) setActiveAssistantMessageIndex(newIndex);

      setActiveAnalysisTab(
        disagreements.length > 0 ? "conflicts"
          : resp.sources?.length ? "sources"
          : resp.plan?.length ? "plan"
          : "overview",
      );
    } catch (e: any) {
      setErr(e?.message ?? "Research request failed.");
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "I hit an error calling the backend. Check Settings → Backend URL and backend logs." },
      ]);
    } finally { setBusy(false); }
  }

  // ── Tab button helper ──
  const tabBtn = (tab: AnalysisTab, label: string) => (
    <button
      type="button"
      onClick={() => setActiveAnalysisTab(tab)}
      className={[
        "rounded-xl px-3 py-1.5 text-xs font-medium transition",
        activeAnalysisTab === tab
          ? "bg-amber-400 text-slate-950"
          : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
      ].join(" ")}
    >
      {label}
    </button>
  );

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">

      {/* ── Top nav ── */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto max-w-[1800px] px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
            <Link to="/settings" className="px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 hover:bg-white/10">Settings</Link>
            <button className="px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 hover:bg-white/10" onClick={logout}>Logout</button>
          </div>
        </div>
      </div>

      {/* ── Three-column layout: 2 / 8 / 2 ── */}
      <div className="mx-auto max-w-[1800px] px-4 py-4 grid grid-cols-12 gap-4">

        {/* ── Left: Documents (2 cols) ── */}
        <aside className="col-span-12 xl:col-span-2">
          <div
            className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 backdrop-blur"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void handleFiles(e.dataTransfer.files); }}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-white">Documents</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {uploading ? "Uploading…" : loadingDocs ? "Loading…" : "Drag, drop, or upload PDFs"}
                </p>
              </div>
              <>
                <button
                  className="text-xs px-2.5 py-1.5 rounded-xl bg-indigo-500 text-white font-medium hover:bg-indigo-400 transition disabled:opacity-50 shrink-0"
                  disabled={uploading || loadingDocs}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  {uploading ? "…" : "Upload"}
                </button>
                <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden"
                  onChange={(e) => void handleFiles(e.target.files)} />
              </>
            </div>

            {err && (
              <div className="mb-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</div>
            )}

            {docs.length > 0 && (
              <div className="mb-3 flex gap-2">
                <button className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10" onClick={selectAll} type="button">All</button>
                <button className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10" onClick={clearSelection} type="button">Clear</button>
              </div>
            )}

            <div className="space-y-2 max-h-[65vh] overflow-auto pr-1">
              {docs.length === 0 ? (
                <div className="text-xs text-slate-400 border border-dashed border-white/15 rounded-2xl p-3">
                  No PDFs yet. Upload one to begin.
                </div>
              ) : (
                docs.map((d) => {
                  const checked = selectedDocIds.has(d.id);
                  return (
                    <div key={d.id} className={["rounded-2xl border px-2.5 py-2.5 transition", checked ? "border-indigo-400/30 bg-indigo-500/10" : "border-white/10 bg-black/20 hover:bg-white/5"].join(" ")}>
                      <div className="flex items-start gap-1.5">
                        <button type="button" onClick={() => toggleDoc(d.id)} className="flex flex-1 items-start gap-2 text-left min-w-0">
                          <span className={["mt-0.5 h-4 w-4 rounded border flex items-center justify-center text-[10px] font-bold shrink-0", checked ? "border-indigo-300/30 bg-indigo-400 text-slate-950" : "border-white/20 bg-black/30 text-transparent"].join(" ")}>✓</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-slate-100">{d.name}</div>
                            <div className="mt-0.5 text-[10px] text-slate-500">{checked ? "Included" : "Excluded"}</div>
                          </div>
                        </button>
                        <button type="button" onClick={() => void handleDelete(d.id)}
                          className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 shrink-0"
                          title="Delete PDF">✕</button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-3 text-[10px] text-slate-600 truncate">{baseUrl}</div>
          </div>
        </aside>

        {/* ── Centre: Research Chat with history sidebar (8 cols) ── */}
        <section className="col-span-12 xl:col-span-8">
          <div className="flex h-[88vh] rounded-3xl border border-white/10 overflow-hidden">

            {/* ── Sessions sidebar ── */}
            {sidebarOpen && (
              <div className="w-52 shrink-0 border-r border-white/10 bg-slate-900/90 flex flex-col">
                {/* Header */}
                <div className="px-3 py-3 border-b border-white/10 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white tracking-wide">History</span>
                  <button
                    type="button"
                    onClick={startNewChat}
                    className="flex items-center gap-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-[11px] font-medium px-2 py-1 transition"
                    title="New chat"
                  >
                    + New
                  </button>
                </div>

                {/* Session list */}
                <div className="flex-1 overflow-auto py-1">
                  {sessions.length === 0 ? (
                    <div className="px-3 py-4 text-[11px] text-slate-500">No conversations yet.</div>
                  ) : (
                    sessions.map((s) => {
                      const isActive = s.id === activeSessionId;
                      return (
                        <div
                          key={s.id}
                          onClick={() => switchSession(s.id)}
                          className={[
                            "group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition",
                            isActive
                              ? "bg-white/10 border-l-2 border-amber-400"
                              : "hover:bg-white/5 border-l-2 border-transparent",
                          ].join(" ")}
                        >
                          <div className="flex-1 min-w-0">
                            <div className={["text-xs font-medium truncate", isActive ? "text-white" : "text-slate-300"].join(" ")}>
                              {s.title}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{relativeDate(s.createdAt)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                            className="opacity-0 group-hover:opacity-100 mt-0.5 shrink-0 text-slate-500 hover:text-red-400 transition text-[11px] leading-none"
                            title="Delete conversation"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ── Chat area ── */}
            <div className="flex flex-1 flex-col bg-white/5 p-5 min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Sidebar toggle */}
                  <button
                    type="button"
                    onClick={() => setSidebarOpen((v) => !v)}
                    className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/10 transition"
                    title={sidebarOpen ? "Hide history" : "Show history"}
                  >
                    {sidebarOpen ? "◀" : "▶"}
                  </button>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-white truncate">Research Chat</h2>
                    <p className="text-xs text-slate-400 hidden sm:block">
                      Ask comparative questions across the selected PDFs.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => exportToPDF()}
                  disabled={!activeAssistantEntry || activeAssistantEntry.index === 0}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition whitespace-nowrap"
                >
                  Export PDF
                </button>
              </div>

              {/* Message list */}
              <div className="flex-1 space-y-4 overflow-auto pr-2">
                {messages.map((m, idx) => {
                  const isActiveAssistant = m.role === "assistant" && idx === activeAssistantMessageIndex;
                  const canExport =
                    m.role === "assistant" &&
                    idx > 0 &&
                    messages[idx - 1]?.role === "user";

                  return (
                    <div key={idx} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                      <button
                        type="button"
                        disabled={m.role !== "assistant"}
                        onClick={() => { if (m.role === "assistant") setActiveAssistantMessageIndex(idx); }}
                        className={[
                          "max-w-[80%] rounded-3xl px-5 py-4 text-left text-sm leading-7 shadow-md transition",
                          m.role === "user"
                            ? "cursor-default bg-indigo-500 text-white"
                            : ["border whitespace-pre-wrap",
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

                      {canExport && (
                        <button
                          type="button"
                          onClick={() => exportToPDF(idx)}
                          className="mt-1.5 ml-1 text-[10px] text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
                          title="Export this response as PDF"
                        >
                          ↓ Export this report
                        </button>
                      )}
                    </div>
                  );
                })}

                {busy && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-3xl border border-white/10 bg-slate-800 px-5 py-4 text-sm text-slate-300">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">BumbleBeee</div>
                      Analyzing the selected documents and assembling grounded evidence…
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Input bar */}
              <div className="mt-4 rounded-3xl border border-white/10 bg-black/20 p-3">
                <div className="flex gap-3">
                  <input
                    className="flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-white/25 disabled:opacity-60"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      hasSelectedDocs
                        ? "Ask about themes, agreements, disagreements, evidence, or summaries across your PDFs…"
                        : "Select a PDF on the left to begin…"
                    }
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    disabled={busy}
                  />
                  <button
                    className="rounded-2xl bg-amber-400 text-slate-950 font-semibold px-6 py-3 text-sm disabled:opacity-50 transition"
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
          </div>
        </section>

        {/* ── Right: Analysis Panel (2 cols) ── */}
        <aside className="col-span-12 xl:col-span-2">
          <div className="flex h-[88vh] flex-col rounded-3xl border border-white/10 bg-slate-900/70 p-4 backdrop-blur">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-white">Analysis</h2>
              <p className="text-xs text-slate-400 mt-0.5">Evidence &amp; reasoning for the selected response.</p>
            </div>

            <div className="mb-3 flex flex-wrap gap-1.5">
              {tabBtn("overview", "Overview")}
              {tabBtn("sources", `Sources${activeAssistantMeta?.sources?.length ? ` (${activeAssistantMeta.sources.length})` : ""}`)}
              {tabBtn("plan", `Plan${activeAssistantMeta?.plan?.length ? ` (${activeAssistantMeta.plan.length})` : ""}`)}
              {tabBtn("conflicts", `Conflicts${activeAssistantMeta?.disagreements?.length ? ` (${activeAssistantMeta.disagreements.length})` : ""}`)}
            </div>

            <div className="flex-1 overflow-auto pr-1">
              {activeAssistantEntry ? (
                <div className="space-y-3">

                  {/* Answer preview */}
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500 mb-1">Selected answer</div>
                    <div className="text-xs leading-5 text-slate-300 line-clamp-5 whitespace-pre-wrap">
                      {activeAssistantEntry.message.content}
                    </div>
                  </div>

                  {/* Overview tab */}
                  {activeAnalysisTab === "overview" && (
                    <div className="space-y-2">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div className="text-xs font-semibold text-white mb-2">Snapshot</div>
                        <div className="space-y-1.5 text-xs text-slate-300 leading-5">
                          <p>{activeAssistantMeta?.sources?.length ? `${activeAssistantMeta.sources.length} source block${activeAssistantMeta.sources.length > 1 ? "s" : ""} cited.` : "No source blocks yet."}</p>
                          <p>{activeAssistantMeta?.plan?.length ? `${activeAssistantMeta.plan.length}-step reasoning plan.` : "No reasoning plan."}</p>
                          <p>{activeAssistantMeta?.disagreements?.length ? `${activeAssistantMeta.disagreements.length} cross-doc difference${activeAssistantMeta.disagreements.length > 1 ? "s" : ""} detected.` : "No disagreements detected."}</p>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3">
                        <div className="text-[10px] font-semibold text-amber-200 mb-1">Tip</div>
                        <div className="text-xs text-amber-100/90 leading-5">
                          Click any assistant message to inspect its evidence here. Use <strong>Export PDF</strong> to save the full report.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sources tab */}
                  {activeAnalysisTab === "sources" && (
                    activeAssistantMeta?.sources?.length ? (
                      <div className="space-y-2">
                        {activeAssistantMeta.sources.map((s, i) => (
                          <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                            <div className="text-xs font-semibold text-white">
                              {s.title || `Source ${i + 1}`}
                              {typeof s.page === "number" && <span className="text-slate-400"> · p.{s.page}</span>}
                            </div>
                            <div className="mt-1.5 text-xs leading-5 text-slate-300 line-clamp-5">
                              {s.snippet || "No snippet provided."}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">No sources returned yet.</div>
                    )
                  )}

                  {/* Plan tab */}
                  {activeAnalysisTab === "plan" && (
                    activeAssistantMeta?.plan?.length ? (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <ol className="list-decimal space-y-2 pl-4 text-xs leading-5 text-slate-300">
                          {activeAssistantMeta.plan.map((step, i) => <li key={i}>{step}</li>)}
                        </ol>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">No reasoning plan returned.</div>
                    )
                  )}

                  {/* Conflicts tab */}
                  {activeAnalysisTab === "conflicts" && (
                    <div className="space-y-2">
                      {activeAssistantMeta?.disagreements?.length ? (
                        activeAssistantMeta.disagreements.map((d, i) => (
                          <div key={i} className="rounded-2xl border border-orange-400/20 bg-orange-500/10 p-3">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-300 mb-1">
                              {d.startsWith("Potential conflict") ? "⚡ Conflict" : "↔ Difference"}
                            </div>
                            <div className="text-xs leading-5 text-slate-200">{d}</div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
                          No cross-document disagreements for this response. Try asking a comparative question across multiple PDFs.
                        </div>
                      )}
                    </div>
                  )}

                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-3 text-xs text-slate-400">
                  No response selected yet.
                </div>
              )}
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
}
