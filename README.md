# Autonomous Research Pilot (Capstone 490)

An **agentic research assistant** that answers questions by reading from a local PDF library and returning a **citation-grounded** response.  
Instead of “chatbot vibes,” the goal is: **plan → retrieve → synthesize → cite**.

In other words:
The Autonomous Research Pilot is an agentic LLM system designed to perform citation-grounded research across multiple PDFs. Instead of answering from general knowledge, the system retrieves relevant document chunks, reasons over them, and generates structured responses where every claim is backed by a traceable citation (document, page, and chunk).
Built using a local embedding-based retrieval system, LangGraph for orchestration, and a Llama-based model via Ollama, the entire pipeline runs locally. The result is a self-contained, multi-document research assistant focused on transparency, grounding, and verifiable reasoning
---

## What it does

You ask a question like:

--> “What are the arguments for and against nuclear energy?”

The backend:
1. builds or loads an index of PDFs in `app/documents/`
2. retrieves the most relevant chunks
3. synthesizes an answer based on those chunks
4. returns a structured JSON response with:
   - a **plan** (steps it followed)
   - **sources/snippets** (evidence)
   - a final **answer** tied to citations

---

## Tech stack

### Backend
- Python + FastAPI
- LangGraph (agentic workflow orchestration)
- Ollama (local LLM runtime)
- Local PDF ingestion + chunking + vector indexing
- Custom RAG pipeline (retrieve → synthesize → cite)


### Frontend
- Vite + React + TypeScript
- TailwindCSS
- Views-based routing (Login / Research / Settings)

---

## Repo structure

### Backend (`app/`)
- app/
- main.py # FastAPI app entry point
- router.py # API routes (e.g., /health, /research)
- schemas.py # request/response schemas
- models.py # data models (if used)
- state.py # app/runtime state (index loaded, config, etc.)
- indexer.py # builds/updates local index from PDFs
- graph.py # workflow graph / orchestration (if applicable)
- documents/ # PDF library (source of truth for answers)
- *.pdf
- skills/research/ # “agent” pipeline modules
- workflow.py # plan → retrieve → synthesize orchestration
- reader.py # PDF/text reading helpers
- retriever.py # chunk retrieval logic
- synthesizer.py # answer writing grounded in evidence
- citations.py # citation formatting / attachment to output
- tools/ # lower-level utilities
- loaders.py # document loading
- chunker.py # chunking logic
- local_index.py # local index abstraction
- vector_store.py # embeddings/vector search layer
- web_search.py # (optional) external search tool


### Frontend (`app_ui/`)
- app_ui/
- src/
- lib/api.ts # client for calling backend endpoints
- state/
- auth.tsx # auth state (lightweight)
- settings.tsx # settings state
- views/
- Loginpage.tsx
- ResearchApp.tsx
- Settingspage.tsx
- routes.tsx # route definitions
- App.tsx
- main.tsx
- index.css
- tailwind.config.js
- postcss.config.cjs
- vite.config.ts
- .env.example



---



## Run the backend

From the directory that contains `app/main.py`:

```bash
# create + activate venv (if not already)
python -m venv .venv
source .venv/bin/activate

# install deps (use your actual file name)
pip install -r requirements.txt

# Start the API
uvicorn app.main:app --reload --port 8000

# to check health 
curl http://127.0.0.1:8000/health


# Frontend Run
cd app_ui
npm install
npm run dev



# API usage
POST /research

#Example to check if the backend is working (do this in a different terminal after running the backend)
curl -s -H "Content-Type: application/json" \ -d '{"question":"What are the arguments for and against nuclear energy?"}' \ http://127.0.0.1:8000/research | python -m json.tool

