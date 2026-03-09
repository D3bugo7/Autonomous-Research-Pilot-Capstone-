import os
from typing import List, Tuple

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings


from app import state


def _list_pdfs(folder: str) -> List[str]:
    if not os.path.exists(folder):
        return []
    return sorted(
        os.path.join(folder, f)
        for f in os.listdir(folder)
        if f.lower().endswith(".pdf")
    )

def _build_embeddings():
    return HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )

def build_or_get_index(pdf_folder: str = "app/documents") -> Tuple[FAISS, List[str]]:
    pdf_paths = _list_pdfs(pdf_folder)
    manifest = [os.path.basename(p) for p in pdf_paths]

    if not pdf_paths:
        raise RuntimeError(f"No PDFs found in {pdf_folder}")

    # Reuse index if nothing changed
    if state.local_index is not None and state.index_manifest == manifest:
        return state.local_index, manifest

    docs = []
    for path in pdf_paths:
        loader = PyPDFLoader(path)
        loaded = loader.load()  # one Document per page
        for d in loaded:
            d.metadata["doc_id"] = os.path.basename(path)
            d.metadata["path"] = path
        docs.extend(loaded)

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1100,
        chunk_overlap=150,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_documents(docs)

    for i, c in enumerate(chunks):
        c.metadata["chunk_id"] = f"chunk_{i}"

    embeddings = _build_embeddings()
    index = FAISS.from_documents(chunks, embeddings)

    state.local_index = index
    state.index_manifest = manifest
    return index, manifest