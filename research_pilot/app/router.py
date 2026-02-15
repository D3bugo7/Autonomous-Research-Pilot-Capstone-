from app.models import ResearchRequest, ResearchResponse
from app.skills.research.workflow import run_research


def route_request(req: ResearchRequest) -> ResearchResponse:
    # Later: detect intent and route to other skills (email, scheduling, etc.)
    return run_research(req.question)
