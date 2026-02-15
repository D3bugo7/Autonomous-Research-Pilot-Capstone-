from app.models import ResearchResponse
from app.skills.research.retriever import retrieve_sources
from app.skills.research.reader import extract_claims
from app.skills.research.synthesizer import synthesize_answer


def run_research(question: str) -> ResearchResponse:
    plan = [
        "Clarify the question intent and key terms",
        "Retrieve a small set of relevant sources",
        "Extract claims and supporting evidence",
        "Synthesize an answer with citations and note disagreements",
    ]

    sources = retrieve_sources(question)
    claims = extract_claims(question, sources)
    answer, citations, disagreements, open_qs = synthesize_answer(question, sources, claims)

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
