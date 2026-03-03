from fastapi import FastAPI
from app.models import ResearchRequest, ResearchResponse
from app.router import route_request
from app import state
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Research Pilot", version="0.1.0")

@app.on_event("startup")
def startup():
    state.local_index = None
    state.index_manifest = None
    print("STARTUP: ready (index will build on first request)")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/research", response_model=ResearchResponse)
def research(req: ResearchRequest):
    print("MAIN: /research hit")
    return route_request(req)

@app.get("/")
def home():
    return {
        "name": "Research Pilot",
        "endpoints": {"health": "/health", "research": "/research", "docs": "/docs"},
    }

@app.get("/favicon.ico")
def favicon():
    return {}