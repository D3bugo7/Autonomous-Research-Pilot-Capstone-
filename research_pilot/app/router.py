from app.models import ResearchRequest, ResearchResponse
from app.skills.research.workflow import run_research
from app.skills.research.retriever import retrieve_sources  # <-- uses the retriever module
from app.skills.research.reader import extract_claims  # uses the reader module

def route_request(req: ResearchRequest) -> ResearchResponse:
    print("ROUTER: route_request start")

    sources = retrieve_sources(req.question)

    out = run_research(req.question)

    # Attach sources if the ResearchResponse has a `sources` field:
    try:
        out.sources = sources
    except Exception:
        pass

    print("ROUTER: route_request done")
    return out

