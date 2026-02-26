from typing import List, Tuple
import re
from app.models import Source, ExtractedClaim, Citation


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def synthesize_answer(
    question: str,
    sources: List[Source],
    claims: List[ExtractedClaim],
) -> Tuple[str, List[Citation], List[str], List[str]]:
    if not sources:
        return (
            "I couldn’t find any indexed sources to answer that yet. Please add PDFs to the documents folder.",
            [],
            [],
            ["Which PDF(s) should I use as sources?"],
        )

    # Build a grounded summary from top sources
    top = sources[:3]
    summary_bits = []
    for s in top:
        snippet = _clean(s.snippet)
        if snippet:
            # take a “lead” slice
            summary_bits.append(snippet[:220].rstrip(" ,.;:") + "...")

    summary = " ".join(summary_bits).strip()
    if not summary:
        summary = "I found sources, but the extracted text was empty or unusable."

    # Add a concise “AI-style” answer body
    answer_lines = []
    answer_lines.append(f"**Question:** {question}")
    answer_lines.append("")
    answer_lines.append("**What the document(s) say:**")
    answer_lines.append(summary)

    # Include key claims as bullets
    if claims:
        answer_lines.append("")
        answer_lines.append("**Key supported points (from retrieved text):**")
        for c in claims[:6]:
            answer_lines.append(f"- {_clean(c.claim)}")

    answer = "\n".join(answer_lines)

    # Basic citations: cite the sources used in summary
    citations = [
    Citation(
        answer_span="What the document(s) say",
        source_url=s.url,
        doc_id=s.doc_id,
        page=s.page,
        chunk_id=s.chunk_id,
    )
    for s in top
]

    disagreements: List[str] = []
    open_questions = [
        "Do you want a high-level summary, or answers to specific sections (methods/results/limitations)?",
        "Should I prioritize the abstract/conclusion if this is a research paper?"
    ]

    return answer, citations, disagreements, open_questions

