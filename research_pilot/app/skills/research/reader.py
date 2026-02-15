from typing import List
from app.models import Source, ExtractedClaim


def extract_claims(question: str, sources: List[Source]) -> List[ExtractedClaim]:
    # MVP stub: pretend we extracted claims from each source.
    claims: List[ExtractedClaim] = []
    for s in sources:
        claims.append(
            ExtractedClaim(
                claim=f"A key claim allegedly supported by {s.title}.",
                evidence=s.snippet,
                source_url=s.url,
            )
        )
    return claims
