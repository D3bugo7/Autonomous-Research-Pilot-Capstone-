import re
from typing import List, Tuple

from app.models import ResearchRequest, ResearchResponse, Source, Citation, Claim
from app.graph import build_graph

_graph = build_graph()

# matches: [Doc.pdf p0 chunk_72]
CIT_RE = re.compile(r"\[([^\]]+?)\s+p(\d+)\s+(chunk_\d+)\]")

def _split_sentences(text: str) -> List[str]:
    text = (text or "").strip()
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if p.strip()]

def _extract_citation_keys(sentence: str) -> List[Tuple[str, int, str]]:
    keys = []
    for doc_id, page_str, chunk_id in CIT_RE.findall(sentence):
        keys.append((doc_id.strip(), int(page_str), chunk_id.strip()))
    # de-dupe while preserving order
    seen = set()
    uniq = []
    for k in keys:
        if k in seen:
            continue
        seen.add(k)
        uniq.append(k)
    return uniq

def route_request(req: ResearchRequest) -> ResearchResponse:
    out = _graph.invoke({
    "question": req.question,
    "user_dir": req.user_dir,  # or however you store uploads
})

    # Build sources from graph evidence
    sources: List[Source] = []
    for e in out.get("evidence", [])[:10]:
        sources.append(Source(
            title=f"{e.doc_id} (page {e.page})",
            url=e.path or e.doc_id,
            snippet=(e.text[:300] + ("..." if len(e.text) > 300 else "")),
            doc_id=e.doc_id,
            page=e.page,
            chunk_id=e.chunk_id,
        ))

    answer = out.get("answer", "") or ""

    # Lookup: (doc_id, page, chunk_id) -> Source
    source_lookup = {(s.doc_id, s.page, s.chunk_id): s for s in sources}

    citations: List[Citation] = []
    claims: List[Claim] = []

    for sent in _split_sentences(answer):
        keys = _extract_citation_keys(sent)

        # strip citation markers from claim text
        claim_text = CIT_RE.sub("", sent).strip()
        if not claim_text:
            continue

        sent_citations: List[Citation] = []
        for (doc_id, page, chunk_id) in keys:
            src = source_lookup.get((doc_id, page, chunk_id))

            # Use a short span for answer_span to keep it concise in the UI; the full claim text is in the Claim object
            answer_span = claim_text[:120] + ("..." if len(claim_text) > 120 else "")

            c = Citation(
                answer_span=answer_span,
                source_url=(src.url if src else doc_id),
                doc_id=doc_id,
                page=page,
                chunk_id=chunk_id,
                quote=(src.snippet if src else None),
            )
            sent_citations.append(c)
            citations.append(c)

        claims.append(Claim(text=claim_text, citations=sent_citations))

    # De-dupe citations list globally
    uniq = {}
    for c in citations:
        key = (c.doc_id, c.page, c.chunk_id, c.source_url)
        uniq[key] = c
    citations = list(uniq.values())

    return ResearchResponse(
        question=req.question,
        plan=out.get("plan", []),
        sources=sources,
        answer=answer,
        claims=claims,
        citations=citations,
        disagreements=[],
        open_questions=[],
        debug=out.get("debug", {}),
    )