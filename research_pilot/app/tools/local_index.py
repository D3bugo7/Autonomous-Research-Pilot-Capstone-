from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

import fitz  # PyMuPDF

# MVP safety limits
MAX_PAGES = 10
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200


@dataclass
class LocalIndex:
    chunks: List[Dict[str, Any]]


def load_pdf(path: Path, max_pages: int = MAX_PAGES) -> Dict[str, Any]:
    print(f"LOAD_PDF: opening {path.name}")
    doc = fitz.open(str(path))
    pages: List[Dict[str, Any]] = []
    limit = min(len(doc), max_pages)
    for i in range(limit):
        try:
            print(f"LOAD_PDF: extracting page {i+1}/{limit} from {path.name}")
            text = doc[i].get_text("text").replace("\x00", "").strip()
            print(f"LOAD_PDF: page {i+1} length={len(text)}")
        except Exception as e:
            print(f"LOAD_PDF: page {i+1} failed: {e}")
            text = ""
        pages.append({"page": i + 1, "text": text})
    doc.close()
    return {"doc_id": path.stem, "path": str(path), "pages": pages}


def chunk_pages(
    pages: List[Dict[str, Any]],
    doc_id: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> List[Dict[str, Any]]:
    if overlap >= chunk_size:
        raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE")

    chunks: List[Dict[str, Any]] = []
    idx = 0

    for p in pages:
        page_num = p.get("page")
        text = (p.get("text") or "").strip()
        if not text:
            continue

        n = len(text)
        start = 0

        while start < n:
            end = min(start + chunk_size, n)
            chunk_text = text[start:end].strip()

            if chunk_text:
                chunks.append(
                    {
                        "chunk_id": f"{doc_id}::p{page_num}::c{idx}",
                        "doc_id": doc_id,
                        "page": page_num,
                        "text": chunk_text,
                        "path": None,
                    }
                )
                idx += 1

            # If we reached the end, stop. This prevents infinite loops.
            if end >= n:
                break

            next_start = end - overlap

            # Safety: if we didn't move forward, stop (prevents no-progress loops).
            if next_start <= start:
                break

            start = next_start

    return chunks


def build_local_index(doc_dir: str | Path) -> LocalIndex:
    d = Path(doc_dir)
    d.mkdir(exist_ok=True)
    chunks: List[Dict[str, Any]] = []
    pdfs = sorted(d.glob("*.pdf"))
    print(f"INDEX: found {len(pdfs)} pdf(s) in {d}")
    for pdf in pdfs:
        try:
            print(f"INDEX: reading {pdf.name} ...")
            doc = load_pdf(pdf, max_pages=MAX_PAGES)
            doc_chunks = chunk_pages(doc["pages"], doc_id=doc["doc_id"])
            for c in doc_chunks:
                c["path"] = doc["path"]
            chunks.extend(doc_chunks)
            print(f"INDEX: loaded {pdf.name} chunks={len(doc_chunks)}")
        except Exception as e:
            print(f"INDEX: skipping {pdf.name} due to error: {e}")
    print(f"INDEX: done. total_chunks={len(chunks)}")
    return LocalIndex(chunks=chunks)


def naive_retrieve(index: LocalIndex, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
    if not index.chunks:
        return []
    q_tokens = [t for t in query.lower().split() if len(t) > 2]
    if not q_tokens:
        return index.chunks[:top_k]
    scored: List[tuple[int, Dict[str, Any]]] = []
    for c in index.chunks:
        text = c["text"].lower()
        score = sum(1 for t in q_tokens if t in text)
        if score > 0:
            scored.append((score, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:top_k]]
