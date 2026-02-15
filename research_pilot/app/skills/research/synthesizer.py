from typing import List, Tuple
from app.models import Source, ExtractedClaim, Citation


def synthesize_answer(
    question: str,
    sources: List[Source],
    claims: List[ExtractedClaim],
) -> Tuple[str, List[Citation], List[str], List[str]]:
    # MVP stub: build a simple answer and attach basic citations.
    answer = (
        f"Here’s a stubbed research answer to: '{question}'. "
        "Right now, the system is wired end-to-end; next we’ll swap in real retrieval and extraction."
    )

    citations = [
        Citation(answer_span="stubbed research answer", source_url=sources[0].url)
    ] if sources else []

    disagreements: List[str] = []
    open_questions = ["What sources should be considered authoritative for this topic?"]

    return answer, citations, disagreements, open_questions
