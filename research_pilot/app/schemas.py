from pydantic import BaseModel
from typing import Any, Dict, List, Optional

class ResearchRequest(BaseModel):
    question: str

class Source(BaseModel):
    doc_id: str
    page: int
    chunk_id: str
    snippet: str

class ResearchResponse(BaseModel):
    question: str
    plan: List[str]
    queries: List[str]
    answer: str
    sources: List[Source]
    debug: Optional[Dict[str, Any]] = None