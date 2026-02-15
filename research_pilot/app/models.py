from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field


class ResearchRequest(BaseModel):
    question: str = Field(..., min_length=3)


class Source(BaseModel):
    title: str
    url: str
    snippet: Optional[str] = None


class ExtractedClaim(BaseModel):
    claim: str
    evidence: Optional[str] = None
    source_url: str


class Citation(BaseModel):
    answer_span: str
    source_url: str


class ResearchResponse(BaseModel):
    question: str
    plan: List[str]
    sources: List[Source]
    claims: List[ExtractedClaim]
    answer: str
    citations: List[Citation]
    disagreements: List[str]
    open_questions: List[str]
