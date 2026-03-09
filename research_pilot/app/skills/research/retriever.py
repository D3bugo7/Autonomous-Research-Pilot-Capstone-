from typing import List, Optional
from pathlib import Path

from app.models import Source
from app.tools.local_index import build_local_index, naive_retrieve

CANDIDATE_K = 25
FINAL_K = 14


def _pretty_doc_id(raw_doc_id: str) -> str:
    if not raw_doc_id:
        return "unknown_doc"
    # uploaded PDFs are stored as: "<uuid>__<original_name>.pdf"
    return raw_doc_id.split("__", 1)[-1]


def _diversify_chunks(chunks: list[dict], max_per_doc: int = 3, max_total: int = 12):
    per_doc: dict[str, int] = {}
    seen_doc_page = set()
    out: list[dict] = []

    for c in chunks:
        raw_doc = c.get("doc_id") or ""
        doc = _pretty_doc_id(raw_doc)
        page = c.get("page")
        key = (doc, page)

        # prevent multiple chunks from same page
        if key in seen_doc_page:
            continue

        per_doc.setdefault(doc, 0)
        if per_doc[doc] >= max_per_doc:
            continue

        # normalize doc_id on the chunk so downstream uses the pretty name
        c["doc_id"] = doc

        out.append(c)
        per_doc[doc] += 1
        seen_doc_page.add(key)

        if len(out) >= max_total:
            break

    return out


def retrieve_sources(
    question: str,
    user_dir: Path,
    allowed_paths: Optional[list[str]] = None,
) -> List[Source]:
    """
    Build an index from a specific user's upload directory,
    retrieve relevant chunks, and optionally filter to selected PDFs.
    """
    user_dir.mkdir(parents=True, exist_ok=True)

    print("INDEX: building from", user_dir)
    index = build_local_index(user_dir)
    print("INDEX: built, chunks =", len(index.chunks))

    if not index.chunks:
        return [
            Source(
                title="No PDFs indexed",
                url="",
                snippet="No PDFs found in your uploaded documents.",
            )
        ]

    # 1) retrieve
    chunks = naive_retrieve(index, question, top_k=CANDIDATE_K)

    # 2) filter to selected PDFs first
    if allowed_paths:
        allowed = set(allowed_paths)
        chunks = [c for c in chunks if c.get("path") in allowed]

    # 3) diversify + normalize doc_id
    chunks = _diversify_chunks(chunks, max_per_doc=3, max_total=12)

    # 4) convert to Source objects
    return [
        Source(
            title=f"{c['doc_id']} (page {c['page']})",
            url=c["path"],
            snippet=c["text"][:600],
            doc_id=c["doc_id"],
            page=c["page"],
            chunk_id=c.get("chunk_id"),
        )
        for c in chunks[:FINAL_K]
    ]