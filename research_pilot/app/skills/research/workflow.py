from app.models import ResearchResponse
from app.skills.research.retriever import retrieve_sources
from app.skills.research.reader import extract_claims
from app.skills.research.synthesizer import synthesize_answer

def run_research(question: str, do_claims: bool = True) -> ResearchResponse:
    print("WORKFLOW: run_research start")

    plan = [
        "Clarify the question intent and key terms",
        "Retrieve a set of relevant sources",
        "Extract claims and supporting evidence",
        "Synthesize an answer with citations and note disagreements",
    ]

    sources = retrieve_sources(question)

    claims = extract_claims(question, sources) if do_claims else []

    answer, citations, disagreements, open_qs = synthesize_answer(
        question=question,
        sources=sources,
        claims=claims,
    )

    print("WORKFLOW: run_research done")

    return ResearchResponse(
        question=question,
        plan=plan,
        sources=sources,
        claims=claims,
        answer=answer,
        citations=citations,
        disagreements=disagreements,
        open_questions=open_qs,
    )
