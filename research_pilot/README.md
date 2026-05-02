# BumbleBeee 🐝 — Autonomous Research Pilot (Capstone 490)

An **agentic, multi-document research assistant** that answers questions by reading your uploaded PDFs and returning **citation-grounded responses**.

Instead of generic AI answers, BumbleBeee follows a structured pipeline: **plan → retrieve → extract → synthesize → cite**.

> Upload PDFs. Ask a research question. Get a structured answer with sources, citations, cross-document disagreements, and an exportable PDF report.

---

## What it does

You upload a set of PDFs and ask something like:

> *"What are the arguments for and against integrating AI into classrooms, and which paper takes the strongest stance?"*

BumbleBeee will:
1. Retrieve the most relevant chunks from your selected PDFs
2. Extract claims and supporting evidence
3. Synthesize a structured, citation-grounded answer
4. Identify disagreements or tensions between documents
5. Return sources with document names and page numbers

The response includes a reasoning plan, source snippets, extracted claims, structured citations, and flagged cross-document conflicts.

---

## Features

- **Multi-PDF research** — Upload and query across up to 8 PDFs simultaneously (sweet spot: 4–6 PDFs, ~10 pages each)
- **Citation-grounded answers** — Every claim is backed by a traceable source (document, page, chunk)
- **Cross-document disagreement detection** — Automatically detects and surfaces conflicts or tensions between papers
- **Export to PDF** — Export any research response as a clean, formatted PDF report
- **Multi-session chat history** — ChatGPT-style sidebar with multiple saved conversations, auto-titled from your first question
- **Per-user document isolation** — Each user's uploaded PDFs are stored and indexed separately
- **JWT authentication** — Secure login/register with token-based auth
- **Configurable retrieval** — Adjust how many source chunks are retrieved per query (3–12) via Settings
- **Dark / Light theme** — Toggle in Settings
- **Deployed** — Frontend on Vercel, backend on Render

---

## Tech Stack

### Backend
- **Python + FastAPI** — REST API, JWT auth, file upload handling
- **SQLite + SQLAlchemy** — User and document records
- **Ollama (llama3)** — Local LLM for synthesis (switchable to OpenAI via env var)
- **PyMuPDF (fitz)** — PDF loading and text extraction
- **Custom RAG pipeline** — TF-based keyword retrieval, chunk diversification, claim extraction
- **LangGraph** — Agentic workflow orchestration (plan → retrieve → extract → synthesize)

### Frontend
- **Vite + React + TypeScript**
- **Tailwind CSS**
- **React Router** — Login / Research / Settings views
- **localStorage** — Multi-session chat persistence

---

## Project Structure

```
research_pilot/
├── app/
│   ├── main.py                  # FastAPI entry point, all API routes
│   ├── auth.py                  # JWT auth (register, login, token verification)
│   ├── db.py                    # SQLAlchemy models (User, Document) + SQLite init
│   ├── models.py                # Pydantic models (Source, ExtractedClaim, Citation)
│   ├── state.py                 # Runtime state
│   ├── graph.py                 # LangGraph workflow definition
│   ├── router.py                # Additional route definitions
│   ├── schemas.py               # Request/response schemas
│   ├── user_uploads/            # Per-user uploaded PDFs (isolated by user ID)
│   ├── documents/               # Sample/default PDFs
│   ├── skills/research/
│   │   ├── workflow.py          # Pipeline orchestration (plan → retrieve → synthesize)
│   │   ├── retriever.py         # Chunk retrieval with diversification + filtering
│   │   ├── reader.py            # Claim extraction from retrieved chunks
│   │   ├── synthesizer.py       # LLM-based answer synthesis with citations
│   │   ├── disagreement.py      # Cross-document conflict detection (domain-agnostic)
│   │   └── citations.py         # Citation formatting
│   └── tools/
│       ├── local_index.py       # Index builder + TF-based retrieval
│       ├── chunker.py           # PDF chunking with overlap
│       ├── loaders.py           # Document loading helpers
│       └── vector_store.py      # Vector store abstraction
│
├── app_ui/
│   ├── src/
│   │   ├── lib/api.ts           # Typed API client
│   │   ├── state/
│   │   │   ├── auth.tsx         # Auth context (login, logout, token)
│   │   │   └── settings.tsx     # Settings context (theme, backendUrl, maxSources)
│   │   ├── views/
│   │   │   ├── Loginpage.tsx    # Login / Register page
│   │   │   ├── ResearchApp.tsx  # Main research UI (chat + sidebar + analysis panel)
│   │   │   └── Settingspage.tsx # Settings (theme, backend URL, source count, clear history)
│   │   ├── routes.tsx
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css            # Global styles + dark/light theme
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── .env.example
│
├── app.db                       # SQLite database (auto-created on first run)
├── requirements.txt
└── .env.example
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/auth/register` | Register a new user |
| `POST` | `/auth/login` | Login, returns JWT token |
| `POST` | `/documents` | Upload a PDF (auth required) |
| `GET` | `/documents` | List user's uploaded PDFs (auth required) |
| `DELETE` | `/documents/{doc_id}` | Delete a PDF (auth required) |
| `POST` | `/research` | Run a research query across selected PDFs (auth required) |

### Example research request
```json
{
  "question": "What are the arguments for and against AI in education?",
  "doc_ids": ["uuid-1", "uuid-2"],
  "max_sources": 8
}
```

---

## Environment Variables

Create a `.env` file in the `research_pilot/` directory:

```env
# LLM Provider — "ollama" (default, local) or "openai"
MODEL_PROVIDER=ollama

# Ollama settings (used when MODEL_PROVIDER=ollama)
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=llama3
OLLAMA_TIMEOUT_S=60

# OpenAI settings (used when MODEL_PROVIDER=openai)
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini

# JWT secret key
SECRET_KEY=your_secret_key_here

# Frontend origin (for CORS)
FRONTEND_ORIGIN=http://localhost:5173
```

---

## Running Locally

### 1. Backend

```bash
cd research_pilot

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate        # macOS/Linux
# .venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Make sure Ollama is running with llama3
ollama pull llama3
ollama serve

# Start the API server
uvicorn app.main:app --reload --port 8000

# Verify it's running
curl http://127.0.0.1:8000/health
```

### 2. Frontend

```bash
cd research_pilot/app_ui

npm install
npm run dev
```

Frontend runs at `http://localhost:5173` by default.

---

## How the Research Pipeline Works

```
User Question + Selected PDF IDs
        ↓
  1. Retrieve
     └─ Build local TF index from user's uploaded PDFs
     └─ Score + rank chunks by relevance to question
     └─ Diversify: max 3 chunks per document, 14 total

  2. Extract Claims
     └─ Reader identifies key claims from each chunk
     └─ Tags each claim with its source doc + page

  3. Detect Disagreements
     └─ Assigns stance (optimistic / critical / balanced) per chunk
     └─ Compares stances across documents to find conflicts
     └─ Falls back to parsing LLM's own disagreement section if
        rule-based detection produces nothing

  4. Synthesize
     └─ Builds evidence blocks with [E1], [E2] labels
     └─ Calls LLM with structured prompt
     └─ Forces named paper-to-paper comparisons in output

  5. Return
     └─ Answer (markdown), citations, sources, plan, disagreements
```

---

## Limitations

- **Optimal PDF count:** 4–6 PDFs, ~10 pages each
- **Max supported:** up to 8 PDFs (response quality degrades past 6 as fewer chunks per doc are retrieved)
- **Context window:** llama3 via Ollama uses a 4096-token context window — switching to OpenAI (128k context) allows scaling to more documents
- **Keyword-based retrieval:** TF scoring, not semantic/embedding-based, so phrasing of the question matters
- **Local LLM inference is slow:** expect 30–90 seconds per query depending on hardware

---

## Deployment

- **Frontend:** Vercel
- **Backend:** Render
- Set `FRONTEND_ORIGIN` on the backend to your Vercel URL
- Set `VITE_API_URL` in Vercel environment variables to your Render backend URL

---

## Capstone Info

**Course:** Capstone 490
**Project:** Autonomous Research Pilot — BumbleBeee
**Stack:** FastAPI · SQLite · Ollama · LangGraph · Vite · React · Tailwind
**Mode:** Multi-PDF citation-grounded RAG with cross-document disagreement detection
