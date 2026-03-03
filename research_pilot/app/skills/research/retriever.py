from typing import List
from pathlib import Path
from app import state
from app.models import Source
from app.tools.local_index import build_local_index, naive_retrieve, HuggingFaceEmbeddings

DOC_DIR = Path(__file__).resolve().parents[2] / "documents"

CANDIDATE_K = 25   
FINAL_K = 8       


def retrieve_sources(question: str) -> List[Source]:
    if state.local_index is None:
        with state.index_lock:
            if state.local_index is None:
                DOC_DIR.mkdir(exist_ok=True)
                print("INDEX: building from", DOC_DIR)
                state.local_index = build_local_index(DOC_DIR)
                print("INDEX: built, chunks =", len(state.local_index.chunks))

    if not state.local_index or not state.local_index.chunks:
        return [
            Source(title="No local PDFs indexed", url="", snippet="Add PDFs to app/documents and restart the server.")
        ]

     # Step 1: retrieve candidates 
    chunks = naive_retrieve(state.local_index, question, top_k=CANDIDATE_K)

    # Step 2 (later): rerank candidates using trained model
    # chunks = rerank(question, chunks)  # <-- training plugin point

    # Step 3: return top evidence chunks
    chunks = naive_retrieve(state.local_index, question, top_k=CANDIDATE_K)

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

_embeddings = None

def _build_embeddings():
    global _embeddings
    if _embeddings is not None:
        return _embeddings
    _embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return _embeddings