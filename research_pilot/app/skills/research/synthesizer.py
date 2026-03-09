from __future__ import annotations

import os
import re
from typing import List, Tuple

import requests

from app.models import Source, ExtractedClaim, Citation

# ----------------------------
# Config
# ----------------------------
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_TIMEOUT_S = float(os.getenv("OLLAMA_TIMEOUT_S", "60"))

_BOILERPLATE_PATTERNS = [
    r"\bthis document provides an in-depth analysis\b",
    r"\bexamining historical context\b",
    r"\btechnical foundations\b",
    r"\beconomic implications\b",
    r"\bpolicy considerations\b",
    r"\bhighlights areas of agreement and disagreement\b",
    r"\bemphasizes evidence-based reasoning\b",
]


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\x00", " ")).strip()


def _deboilerplate(text: str) -> str:
    t = _clean(text)

    # remove boilerplate phrases from the ORIGINAL text (case-insensitive)
    for pat in _BOILERPLATE_PATTERNS:
        t = re.sub(pat, "", t, flags=re.IGNORECASE)

    # cleanup: collapse repeated commas and spaces that become ", , ,"
    t = re.sub(r"(,\s*){2,}", ", ", t)          # ", , ," -> ", "
    t = re.sub(r"\s+,", ",", t)                 # " ," -> ","
    t = re.sub(r",\s+\.", ".", t)               # ", ." -> "."
    t = re.sub(r"\s{2,}", " ", t).strip()       # extra spaces
    t = t.strip(" ,;:-")                        # trim junk ends

    # if we nuked too much and it's now tiny, fall back to original cleaned text
    return t if len(t) >= 80 else _clean(text)


def _dedupe_sources(sources: List[Source], max_keep: int = 8) -> List[Source]:
    seen = set()
    out: List[Source] = []
    for s in sources:
        key = (_clean(s.snippet)[:240]).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= max_keep:
            break
    return out


def _call_ollama(prompt: str) -> str:
    url = f"{OLLAMA_HOST}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2, "num_ctx": 4096},
    }
    r = requests.post(url, json=payload, timeout=OLLAMA_TIMEOUT_S)
    r.raise_for_status()
    data = r.json()
    return (data.get("response") or "").strip()

def _pretty_format(text: str) -> str:
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()

    # Put headings on their own line: "... ## Summary ..." -> "\n\n## Summary ..."
    t = re.sub(r"\s*(##\s+)", r"\n\n\1", t)

    # Ensure there's a newline after the heading text: "## Summary blah" -> "## Summary\nblah"
    t = re.sub(r"(##[^\n]+)\s+", r"\1\n", t)

    # Normalize bullets and ensure each bullet starts on its own line
    t = t.replace("•", "-")
    t = re.sub(r"\s-\s+", r"\n- ", t)

    # Collapse extra blank lines
    t = re.sub(r"\n{3,}", "\n\n", t)

    return t.strip()

def synthesize_answer(
    question: str,
    sources: List[Source],
    claims: List[ExtractedClaim],
) -> Tuple[str, List[Citation], List[str], List[str]]:
    if not sources:
        return (
            "I couldn’t find any indexed sources yet. Upload PDFs and select them on the left.",
            [],
            [],
            ["Which PDF(s) should I use as sources?"],
        )

    sources_used = _dedupe_sources(sources, max_keep=8)

    # Build evidence blocks (ONLY use pretty doc_id from Source; never print paths/uuids)
    evidence_blocks: List[str] = []
    for i, s in enumerate(sources_used, start=1):
        doc = s.doc_id or "unknown_doc"
        page = s.page or "?"
        chunk = s.chunk_id or "?"
        snippet = _deboilerplate(s.snippet)

        evidence_blocks.append(
            f"[E{i} | {doc} | p.{page} | {chunk}]\n{snippet}"
        )

    evidence_text = "\n\n".join(evidence_blocks)

    # Build ordered doc list (unique in appearance order)
    doc_list: List[str] = []
    seen_docs = set()
    for s in sources_used:
        d = s.doc_id or "unknown_doc"
        if d not in seen_docs:
            seen_docs.add(d)
            doc_list.append(d)

    paper_map = "\n".join([f"Paper {i+1}: {name}" for i, name in enumerate(doc_list)])

    prompt = f"""
You are a research assistant. Answer using ONLY the evidence blocks below.

Rules:
- Do not invent facts not stated in the evidence.
- Every bullet MUST end with a citation like (E2) or (E5).
- Use the paper mapping below. Do not invent extra papers.

Paper mapping:
{paper_map}

Question:
{question}

Evidence:
{evidence_text}

Return the answer in Markdown EXACTLY like this:

## Summary
(3–6 sentences)

## A) Paper 1: <name>
- bullet (E#)
- bullet (E#)

## B) Paper 2: <name>
- bullet (E#)
- bullet (E#)

## C) Common themes
- bullet (E#)
- bullet (E#)

## D) Limits
- bullet
- bullet

IMPORTANT: Use line breaks. Never put multiple bullets on the same line.
- Bullets must be complete sentences. Do not include dangling commas or empty placeholders.
- If a bullet would be vague due to generic evidence, say so explicitly in that bullet.

""".strip()

    try:
        llm_answer = _call_ollama(prompt)
        llm_answer = _pretty_format(llm_answer)
    except Exception as e:
        # fallback
        top = sources_used[:3]
        summary_bits = []
        for s in top:
            snippet = _clean(s.snippet)
            if snippet:
                summary_bits.append(snippet[:220].rstrip(" ,.;:") + "...")
        summary = " ".join(summary_bits).strip() or "I found sources, but the extracted text was empty or unusable."

        llm_answer = "\n".join(
            [
                f"Question: {question}",
                "",
                "Summary (fallback):",
                summary,
                "",
                f"Note: Ollama call failed: {type(e).__name__}",
            ]
        )

    citations = [
        Citation(
            answer_span="LLM synthesis (evidence blocks)",
            source_url=s.url,
            doc_id=s.doc_id,
            page=s.page,
            chunk_id=s.chunk_id,
        )
        for s in sources_used[:5]
    ]

    disagreements: List[str] = []
    open_questions = [
        "Do you want a summary per PDF (doc-by-doc) or one combined answer?",
        "Should I extract arguments for vs against (if the topic is debated)?",
    ]

    return llm_answer, citations, disagreements, open_questions