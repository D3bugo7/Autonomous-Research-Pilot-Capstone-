from fastapi import FastAPI
from app.models import ResearchRequest, ResearchResponse
from app.router import route_request

app = FastAPI(title="Research Pilot", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/research", response_model=ResearchResponse)
def research(req: ResearchRequest):
    # Router decides which skill to use (for now, always "research")
    return route_request(req)

@app.get("/")
def home():
    return {
        "name": "Research Pilot",
        "endpoints": {
            "health": "/health",
            "research": "/research",
            "docs": "/docs",
        },
    }

@app.get("/favicon.ico")
def favicon():
    # stop 404 noise in logs
    return {}
