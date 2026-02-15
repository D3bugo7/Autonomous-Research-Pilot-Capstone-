from typing import List
from app.models import Source


def retrieve_sources(question: str) -> List[Source]:
    # MVP stub: return placeholders so pipeline works end-to-end.
    # Next step: implement web search or local-doc retrieval here.
    return [
        Source(
            title="Stub Source 1",
            url="https://example.com/source1",
            snippet=f"Placeholder snippet related to: {question}",
        ),
        Source(
            title="Stub Source 2",
            url="https://example.com/source2",
            snippet="Another placeholder snippet that might disagree or add nuance.",
        ),
    ]
