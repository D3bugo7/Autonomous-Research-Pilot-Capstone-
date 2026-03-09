from typing import List
import re
from app.models import Source, ExtractedClaim


_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")

# entences that often contain “claim-like” info
_CLAIM_TRIGGERS = (
    " is ", " are ", " was ", " were ",
    " will ", " can ", " cannot ",
    " designed ", " capable ", " aims ", " propose", " propose ", " show", " show ",
    " results", " conclude", " we find", " we show", " we propose"
)


def _split_sentences(text: str) -> List[str]:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if not text:
        return []
    return [s.strip() for s in _SENT_SPLIT.split(text) if len(s.strip()) > 20]


def extract_claims(question: str, sources: List[Source]) -> List[ExtractedClaim]:
    claims: List[ExtractedClaim] = []

    for s in sources:
        sentences = _split_sentences(s.snippet)

        picked = []
        for sent in sentences:
            low = f" {sent.lower()} "
            if any(t in low for t in _CLAIM_TRIGGERS):
                picked.append(sent)
            if len(picked) >= 3:
                break


        if not picked and sentences:
            picked = [sentences[0]]

        for sent in picked:
            claims.append(
                ExtractedClaim(
                    claim=sent,
                    evidence=sent,
                    source_url=s.url,
                    doc_id=s.doc_id,
                    page=s.page,
                    chunk_id=s.chunk_id,
                )
            )
            
    return claims


