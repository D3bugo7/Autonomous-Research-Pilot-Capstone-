from pathlib import Path
from app.state import ResearchState
from app.skills.research.retriever import retrieve_sources
from app.skills.research.reader import extract_claims
from app.skills.research.synthesizer import synthesize_answer


def retrieve_node(state: ResearchState) -> ResearchState:
    sources = retrieve_sources(
        question=state["question"],
        user_dir=Path(state["user_dir"]),
    )
    return {"sources": sources}


def claims_node(state: ResearchState) -> ResearchState:
    claims = extract_claims(
        state["question"],
        state.get("sources", [])
    )
    return {"claims": claims}


def synthesize_node(state: ResearchState) -> ResearchState:
    answer, citations, disagreements, open_qs = synthesize_answer(
        question=state["question"],
        sources=state.get("sources", []),
        claims=state.get("claims", []),
    )

    return {
        "answer": answer,
        "citations": citations,
        "disagreements": disagreements,
        "open_questions": open_qs,
    }