from __future__ import annotations
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class ResearchRequest(BaseModel):
    question: str = Field(..., min_length=3)
    session_id: Optional[str] = None 


class Source(BaseModel):
    title: str
    url: str
    snippet: str
    doc_id: str
    page: int
    chunk_id: str

class ExtractedClaim(BaseModel):
    claim: str
    evidence: Optional[str] = None
    source_url: str
    doc_id: Optional[str] = None
    page: Optional[int] = None
    chunk_id: Optional[str] = None


class Citation(BaseModel):
    answer_span: str
    source_url: str
    doc_id: Optional[str] = None
    page: Optional[int] = None
    chunk_id: Optional[str] = None
    quote: Optional[str] = None 

class Claim(BaseModel):
    text: str
    citations: List[Citation] = []

class Disagreement(BaseModel):
    topic: str
    sides: List[str] = []

class ResearchResponse(BaseModel):
    question: str
    plan: List[str] = []
    sources: List[Source] = []
    answer: str = ""

    # add defaults so pydantic doesn’t error
    claims: List[Claim] = []
    citations: List[Citation] = []
    disagreements: List[Disagreement] = []
    open_questions: List[str] = []

    debug: Optional[Dict[str, Any]] = None

    