import { useMemo, useState } from "react";
import { postResearch, type ResearchResponse } from "./lib/api";

function isProbablyUrl(s?: string) {
  if (!s) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const DEFAULT_BACKEND_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BACKEND_URL);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ResearchResponse | null>(null);

  const canSubmit = useMemo(() => question.trim().length > 2 && !loading, [question, loading]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setData(null);
    setLoading(true);

    try {
      const resp = await postResearch(baseUrl.trim(), "", { question: question.trim(), doc_ids: [] });
      setData(resp);
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rp">
      <header className="rp__header">
        <div>
          <h1>Research Pilot</h1>
          <p className="muted">Ask a question → see the plan + sources your backend returns.</p>
        </div>
        <div className="rp__baseurl">
          <label className="muted">Backend</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={DEFAULT_BACKEND_URL}
          />
        </div>
      </header>

      <main className="rp__main">
        <form onSubmit={onSubmit} className="card">
          <label className="label">Your question</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g., What are the arguments for and against nuclear energy?"
            rows={3}
          />
          <div className="row">
            <button type="submit" disabled={!canSubmit}>
              {loading ? "Researching…" : "Run research"}
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() =>
                setQuestion("What is this document about?")
              }
              disabled={loading}
            >
              Example prompt
            </button>
          </div>

          {err && (
            <div className="error">
              <div className="error__title">Request failed</div>
              <div className="error__msg">{err}</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Tip: if you see CORS errors, enable CORS on your FastAPI app (I’ll show you below).
              </div>
            </div>
          )}
        </form>

        {loading && (
          <div className="card">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" style={{ width: "60%" }} />
          </div>
        )}

        {data && (
          <div className="grid">
            <section className="card">
              <h2>Plan</h2>
              {Array.isArray(data.plan) && data.plan.length > 0 ? (
                <ol className="list">
                  {data.plan.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              ) : (
                <p className="muted">No plan returned.</p>
              )}
            </section>

            <section className="card">
              <h2>Sources</h2>
              {Array.isArray(data.sources) && data.sources.length > 0 ? (
                <div className="sources">
                  {data.sources.map((s, idx) => (
                    <div key={idx} className="source">
                      <div className="source__top">
                        <div className="source__title">{s.title || `Source ${idx + 1}`}</div>
                        {s.url ? (
                          isProbablyUrl(s.url) ? (
                            <a className="source__link" href={s.url} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          ) : (
                            <span className="muted">{s.url}</span>
                          )
                        ) : null}
                      </div>
                      {s.snippet ? <p className="source__snippet">{s.snippet}</p> : <p className="muted">No snippet.</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No sources returned.</p>
              )}
            </section>

            <section className="card" style={{ gridColumn: "1 / -1" }}>
              <h2>Raw response</h2>
              <pre className="code">{JSON.stringify(data, null, 2)}</pre>
            </section>
          </div>
        )}
      </main>

      <footer className="rp__footer muted">
        If your backend is local, keep it running at <code>127.0.0.1:8000</code>.
      </footer>
    </div>
  );
}