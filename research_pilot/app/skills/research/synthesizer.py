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


# ----------------------------
# Helpers
# ----------------------------
def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\x00", " ")).strip()


def _deboilerplate(text: str) -> str:
    original = _clean(text)
    t = original

    for pat in _BOILERPLATE_PATTERNS:
        t = re.sub(pat, "", t, flags=re.IGNORECASE)

    t = re.sub(r"(,\s*){2,}", ", ", t)
    t = re.sub(r"\s+,", ",", t)
    t = re.sub(r",\s+\.", ".", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    t = t.strip(" ,;:-")

    return t if len(t) >= 80 else original


def _dedupe_sources(sources: List[Source], max_keep: int = 8) -> List[Source]:
    seen = set()
    out: List[Source] = []

    for s in sources:
        snippet_key = _clean(s.snippet)[:240].lower()
        doc_key = (s.doc_id or "").strip().lower()
        page_key = str(s.page or "?")
        key = (doc_key, page_key, snippet_key)

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
        "options": {
            "temperature": 0.2,
            "num_ctx": 4096,
        },
    }

    r = requests.post(url, json=payload, timeout=OLLAMA_TIMEOUT_S)
    r.raise_for_status()
    data = r.json()
    return (data.get("response") or "").strip()


def _pretty_format(text: str) -> str:
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()

    # Normalize bullets
    t = t.replace("•", "-")

    # Ensure headings have spacing
    t = re.sub(r"\n?(##[^\n]+)", r"\n\n\1", t)
    t = re.sub(r"\n?(###\s+[^\n]+)", r"\n\n\1", t)

    # Put bullets on their own lines
    t = re.sub(r"\s-\s+", r"\n- ", t)

    # Collapse excessive blank lines
    t = re.sub(r"\n{3,}", "\n\n", t)

    return t.strip()


def _question_mode(question: str) -> str:
    q = (question or "").lower().strip()

    structured_triggers = [
        "compare",
        "difference",
        "differences",
        "similarities",
        "similarity",
        "contrast",
        "breakdown",
        "each file",
        "each document",
        "per document",
        "document by document",
        "doc by doc",
        "detailed report",
        "analyze each",
    ]

    concise_triggers = [
        "main topic",
        "what is this about",
        "what are these about",
        "what is discussed",
        "in both files",
        "in both documents",
        "common topic",
        "shared topic",
        "summary",
        "summarize",
        "overall topic",
    ]

    if any(phrase in q for phrase in structured_triggers):
        return "structured"

    if any(phrase in q for phrase in concise_triggers):
        return "concise"

    return "concise"


def _build_evidence_blocks(sources_used: List[Source]) -> str:
    blocks: List[str] = []

    for i, s in enumerate(sources_used, start=1):
        doc = s.doc_id or "unknown_doc"
        page = s.page or "?"
        chunk = s.chunk_id or "?"
        snippet = _deboilerplate(s.snippet)

        blocks.append(
            f"[E{i} | {doc} | p.{page} | {chunk}]\n{snippet}"
        )

    return "\n\n".join(blocks)


def _build_doc_list(sources_used: List[Source]) -> List[str]:
    docs: List[str] = []
    seen = set()

    for s in sources_used:
        doc = s.doc_id or "unknown_doc"
        if doc not in seen:
            seen.add(doc)
            docs.append(doc)

    return docs


def _build_prompt(question: str, evidence_text: str, doc_list: List[str], mode: str) -> str:
    paper_map = "\n".join([f"Paper {i+1}: {name}" for i, name in enumerate(doc_list)])

    if mode == "structured":
        return f"""
You are a research assistant. Answer using ONLY the evidence blocks below.

Rules:
- Do not invent facts not stated in the evidence.
- Cite each substantive claim with evidence labels like (E1), (E2), or (E3).
- Keep the response clear, natural, and useful.
- Use the paper mapping below when referring to documents.
- If the evidence is incomplete, weak, or conflicting, include a short Limits section.
- If the evidence is strong and clear, omit the Limits section.
- Do not expose internal system notes or raw retrieval artifacts.

Paper mapping:
{paper_map}

Question:
{question}

Evidence:
{evidence_text}

Return clean Markdown in this style:

## Summary
Write 2-4 sentences answering the question directly.

## Document breakdown
### Paper 1: <name>
- complete sentence with citation (E#)
- complete sentence with citation (E#)

### Paper 2: <name>
- complete sentence with citation (E#)
- complete sentence with citation (E#)

## Key similarities or differences
- complete sentence with citation (E#)
- complete sentence with citation (E#)

## Limits
- include only if needed

Important:
- Use line breaks properly.
- Keep bullets concise and complete.
- Do not include empty sections.
""".strip()

    return f"""
You are a research assistant. Answer using ONLY the evidence blocks below.

Rules:
- Do not invent facts not stated in the evidence.
- Cite important claims with evidence labels like (E1), (E2), or (E3).
- Answer the user's question directly and naturally.
- If the question is about multiple documents, synthesize the shared topic first.
- Mention differences only if they help answer the question.
- Do not use report-style headings unless clearly needed.
- Do not include a Limits section unless the evidence is incomplete or conflicting.
- Do not expose internal notes, chunk IDs, or retrieval details.
- Do NOT refer to documents as "File [E1]" or similar.
- Do NOT use evidence IDs (E1, E2, etc.) as document names.
- Refer to documents as:
  - "one document", "the other document"
  - OR use the actual document names if available.
- Evidence labels like (E1) should only appear at the end of sentences as c
- Use phrases like "one document", "the other document", or the document names instead.
- When referring to documents, prioritize meaningful descriptions over labels.

Question:
{question}

Evidence:
{evidence_text}

Return clean Markdown:
- Start with a direct answer in 2-4 sentences.
- Optionally add 1-3 short bullet points if they improve clarity.
- Keep the tone natural, not robotic.
""".strip()

def _fallback_answer(question: str, sources_used: List[Source], error: Exception) -> str:
    top = sources_used[:3]

    citation_refs = []
    summary_bits = []

    for i, s in enumerate(top, start=1):
        doc = s.doc_id or "unknown_doc"
        page = s.page or "?"
        snippet = _clean(s.snippet)

        if snippet:
            short_snippet = snippet[:180].rstrip(" ,.;:") + "..."
            summary_bits.append(f"- {short_snippet} [Source: {doc}, p.{page}]")
            citation_refs.append(f"{doc} p.{page}")

    refs_line = ", ".join(citation_refs) if citation_refs else "available sources"

    evidence_lines = summary_bits if summary_bits else [
    "- I found sources, but the extracted text was empty or unusable."
]   
    return "\n".join(
        [
        "I found relevant content in the uploaded documents, but I couldn’t generate a full synthesized answer because the language model call failed.",
        "",
        f"Relevant sources found: {refs_line}",
        "",
        "Top extracted evidence:",
        *evidence_lines,
        "",
        f"_Model error: {type(error).__name__}_",
        ]
    ).strip()


def _build_open_questions(question: str, mode: str, sources_used: List[Source]) -> List[str]:
    doc_count = len({s.doc_id for s in sources_used if s.doc_id})

    if mode == "structured":
        return [
            "Do you want a shorter combined answer instead of a document-by-document breakdown?",
            "Should I highlight disagreements or differences more explicitly?",
        ]

    if doc_count > 1:
        return [
            "Do you want a document-by-document breakdown next?",
            "Should I compare the differences between the files in more detail?",
        ]

    return [
        "Do you want a shorter summary or a more detailed explanation?",
        "Should I extract the key tasks, requirements, or conclusions from the document?",
    ]


# ----------------------------
# Main entry point
# ----------------------------
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
    evidence_text = _build_evidence_blocks(sources_used)
    doc_list = _build_doc_list(sources_used)
    mode = _question_mode(question)
    prompt = _build_prompt(question, evidence_text, doc_list, mode)

    try:
        llm_answer = _call_ollama(prompt)
        llm_answer = _pretty_format(llm_answer)

        if not llm_answer:
            raise ValueError("Empty response from Ollama")

    except Exception as e:
        llm_answer = _fallback_answer(question, sources_used, e)

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

    # Optional future improvement:
    # populate disagreements using claims if conflicting facts are detected.
    if len(doc_list) > 1 and claims:
        pass

    open_questions = _build_open_questions(question, mode, sources_used)

    return llm_answer, citations, disagreements, open_questions
