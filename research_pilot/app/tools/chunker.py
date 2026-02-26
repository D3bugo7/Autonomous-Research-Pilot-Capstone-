from typing import List, Dict, Any

def chunk_pages(pages: List[Dict[str, Any]], doc_id: str, chunk_size: int = 1200, overlap: int = 200) -> List[Dict[str, Any]]:
    """
    Chunks page text while preserving page numbers for citation.
    Character-based chunking for MVP.
    """
    chunks: List[Dict[str, Any]] = []
    idx = 0

    for p in pages:
        page_num = p["page"]
        text = (p.get("text") or "").strip()
        if not text:
            continue

        start = 0
        n = len(text)
        while start < n:
            end = min(start + chunk_size, n)
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append({
                    "chunk_id": f"{doc_id}::p{page_num}::c{idx}",
                    "doc_id": doc_id,
                    "page": page_num,
                    "text": chunk_text,
                })
                idx += 1

            start = end - overlap
            if start < 0:
                start = 0
            if start >= n:
                break

    return chunks
