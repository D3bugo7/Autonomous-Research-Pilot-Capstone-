from __future__ import annotations
from typing import List, TypedDict, Dict, Any
from dataclasses import dataclass

from langgraph.graph import StateGraph, END
from langchain_core.documents import Document
from langchain_core.messages import SystemMessage, HumanMessage

from app.indexer import build_or_get_index

from langchain_ollama import ChatOllama


@dataclass
class Evidence:
    doc_id: str
    path: str
    page: int
    chunk_id: str
    text: str

class GraphState(TypedDict, total=False):
    question: str
    plan: List[str]
    queries: List[str]
    retrieved: List[Document]
    evidence: List[Evidence]
    draft_answer: str
    answer: str
    retry_count: int
    debug: Dict[str, Any]

_LLM = None

def _llm():
    global _LLM
    if _LLM is None:
        _LLM = ChatOllama(
            model="llama3.1:8b",
            temperature=0,
            num_ctx=4096,
            stream=False,
            timeout=120,
        )
    return _LLM

def plan_node(state: GraphState) -> GraphState:
    q = state["question"]
    llm = _llm()

    sys = SystemMessage(content=(
        "You are a research planner. Output a plan and 2-4 retrieval queries.\n"
        "Return EXACTLY:\n"
        "PLAN:\n- ...\nQUERIES:\n- ...\n"
    ))
    out = llm.invoke([sys, HumanMessage(content=f"Question: {q}")]).content

    plan, queries, mode = [], [], None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("PLAN:"):
            mode = "plan"; continue
        if line.startswith("QUERIES:"):
            mode = "queries"; continue
        if line.startswith("- "):
            item = line[2:].strip()
            if mode == "plan": plan.append(item)
            if mode == "queries": queries.append(item)

    if not queries:
        queries = [q]

    return {
        "plan": plan[:6] if plan else ["Retrieve relevant passages", "Extract evidence", "Synthesize answer with citations"],
        "queries": queries[:4],
        "retry_count": state.get("retry_count", 0),
    }

def retrieve_node(state: GraphState) -> GraphState:
    import hashlib

    index, manifest = build_or_get_index("app/documents")

    retrieved: List[Document] = []
    for query in state["queries"]:
        retrieved.extend(index.similarity_search(query, k=4))

    #de-dup by normalized text (better than chunk_id alone)
    seen = set()
    uniq = []
    for d in retrieved:
        norm = " ".join(d.page_content.split())  # collapse whitespace
        h = hashlib.md5(norm.encode("utf-8")).hexdigest()
        if h in seen:
            continue
        seen.add(h)
        uniq.append(d)

    return {
        "retrieved": uniq[:20],
        "debug": {"pdfs_indexed": manifest, "retrieved_count": len(uniq[:20])},
    }

def evidence_node(state: GraphState) -> GraphState:
    ev: List[Evidence] = []
    for d in state.get("retrieved", [])[:6]:
        ev.append(Evidence(
            doc_id=str(d.metadata.get("doc_id", "unknown.pdf")),
            path=str(d.metadata.get("path", "")),
            page=int(d.metadata.get("page", -1)),
            chunk_id=str(d.metadata.get("chunk_id", "unknown_chunk")),
            text=d.page_content.strip(),
        ))
    return {"evidence": ev}

def synthesize_node(state: GraphState) -> GraphState:
    llm = _llm()
    q = state["question"]
    ev = state.get("evidence", [])

    max_chunks = 6
    max_chars_per_chunk = 900

    evidence_blob = "\n\n".join(
    f"[{e.doc_id} p{e.page} {e.chunk_id}]\n{e.text[:max_chars_per_chunk]}"
    for e in ev[:max_chunks]
)

    sys = SystemMessage(content=(
        "You are a citation-grounded research assistant.\n"
        "Rules:\n"
        "1) Use ONLY the provided evidence.\n"
        "2) Every non-trivial claim MUST include a citation like [Doc.pdf p3 chunk_12].\n"
        "3) If evidence is insufficient, say what’s missing.\n"
    ))

    draft = llm.invoke([
        sys,
        HumanMessage(content=f"Question:\n{q}\n\nEvidence:\n{evidence_blob}\n\nAnswer:")
    ]).content

    return {"draft_answer": draft}

def verify_node(state: GraphState) -> GraphState:
    draft = state.get("draft_answer", "")
    retry = state.get("retry_count", 0)

    # simple heuristic: does it include bracket citations with chunk_
    ok = ("[" in draft) and ("chunk_" in draft)

    if ok or retry >= 1:
        return {"answer": draft}

    refined = (state.get("queries", []) + [state["question"] + " supporting evidence"])[:4]
    return {"queries": refined, "retry_count": retry + 1}

def router(state: GraphState) -> str:
    return "done" if state.get("answer") else "retry"

def build_graph():
    g = StateGraph(GraphState)
    g.add_node("plan", plan_node)
    g.add_node("retrieve", retrieve_node)
    g.add_node("evidence", evidence_node)
    g.add_node("synthesize", synthesize_node)
    g.add_node("verify", verify_node)

    g.set_entry_point("plan")
    g.add_edge("plan", "retrieve")
    g.add_edge("retrieve", "evidence")
    g.add_edge("evidence", "synthesize")
    g.add_edge("synthesize", "verify")

    g.add_conditional_edges("verify", router, {"retry": "retrieve", "done": END})
    return g.compile()