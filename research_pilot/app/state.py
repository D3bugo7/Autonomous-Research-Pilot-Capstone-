from typing import TypedDict, List, Optional
from app.models import Source, Citation, Claim

class ResearchState(TypedDict, total=False):
    question: str
    user_dir: str

    # pipeline
    sources: List[Source]
    claims: List[Claim]

    # outputs
    answer: str
    citations: List[Citation]
    disagreements: List[str]
    open_questions: List[str]

    # control
    retry_count: int