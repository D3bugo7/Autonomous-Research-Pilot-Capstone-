from __future__ import annotations

import os
import re
from typing import List, Tuple

import requests
from openai import OpenAI
from pathlib import Path
from pypdf import PdfReader

from app.models import Source, ExtractedClaim, Citation
from app.skills.research.disagreement import (
    normalize_claims_from_sources,
    compare_claims,
)

# ----------------------------
# Config
# ----------------------------
MODEL_PROVIDER = os.getenv("MODEL_PROVIDER", "ollama").lower()

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_TIMEOUT_S = float(os.getenv("OLLAMA_TIMEOUT_S", "60"))

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TIMEOUT_S = float(os.getenv("OPENAI_TIMEOUT_S", "60"))

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

def _load_full_pdf_text(pdf_path: str) -> str:
    try:
        reader = PdfReader(pdf_path)
        pages = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text:
                pages.append(text)
        return "\n".join(pages)
    except Exception:
        return ""

def _filter_docs_for_question(question: str, sources: List[Source]) -> List[Source]:
    q = (question or "").lower()

    # group sources by doc
    by_doc = {}
    for s in sources:
        doc = s.doc_id or "unknown_doc"
        by_doc.setdefault(doc, []).append(s)

    # detect specific exercise
    if "exercise 4" in q or "4th" in q:
        return by_doc.get("4-Exercise-4-Goals-and-Objectives", sources)

    if "exercise 5" in q or "5th" in q:
        return by_doc.get("5-Exercise-5-Goals-and-Objectives", sources)

    # detect "one PDF"
    if "one pdf" in q or "one document" in q:
        # just return first document
        first_doc = list(by_doc.keys())[0]
        return by_doc[first_doc]

    return sources  # default: use all


def _extract_total_from_full_text(full_text: str) -> int:
    """
    Prefer top-level numbered exercise totals like:
      1) [20 points total]
      2) [30 points total]
      3) [20 points total]
      4) [30 points total]

    Fall back to rubric TOTAL lines if needed.
    """
    if not full_text.strip():
        return 0

    normalized = re.sub(r"\s+", " ", full_text)

    # Top-level numbered sections anywhere in the document
    top_level_matches = re.findall(
        r"(\d+)\)\s*\[\s*(\d+)\s*(?:points?|pts?)\s*(?:total)?\s*\]",
        normalized,
        flags=re.IGNORECASE,
    )

    seen_sections = set()
    top_level_total = 0
    for section_num, value in top_level_matches:
        key = (section_num, value)
        if key in seen_sections:
            continue
        seen_sections.add(key)
        top_level_total += int(value)

    # Fallback: rubric totals
    rubric_total_matches = re.findall(
        r"\bTOTAL\s*[:\-]?\s*(\d+)\b",
        normalized,
        flags=re.IGNORECASE,
    )
    rubric_total = sum(int(x) for x in rubric_total_matches)

    if top_level_total > 0:
        return top_level_total
    return rubric_total


def _extract_assignment_totals_from_full_docs(sources: List[Source]) -> dict[str, int]:
    """
    Compute totals from full PDFs, not retrieved snippets.
    Dedupes by document path.
    """
    by_doc: dict[str, int] = {}
    seen_docs = set()

    for s in sources:
        doc = s.doc_id or "unknown_doc"
        pdf_path = s.url or ""

        if not pdf_path or pdf_path in seen_docs:
            continue
        seen_docs.add(pdf_path)

        full_text = _load_full_pdf_text(pdf_path)
        total = _extract_total_from_full_text(full_text)

        if total > 0:
            by_doc[doc] = total

    return by_doc

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


def _call_llm(prompt: str) -> str:
    if MODEL_PROVIDER == "ollama":
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

    elif MODEL_PROVIDER == "openai":
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.2,
            messages=[
                {"role": "user", "content": prompt}
            ],
        )

        content = response.choices[0].message.content
        return (content or "").strip()

    else:
        raise ValueError(f"Unsupported MODEL_PROVIDER: {MODEL_PROVIDER}")


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


def _is_calc_question(question: str) -> bool:
    q = (question or "").lower()
    triggers = [
        "total",
        "combined",
        "sum",
        "points",
        "worth",
        "score",
        "how many points",
        "altogether",
    ]
    return any(t in q for t in triggers)


def _build_evidence_blocks(sources_used: List[Source]) -> str:
    blocks: List[str] = []

    for i, s in enumerate(sources_used, start=1):
        doc = s.doc_id or "unknown_doc"
        page = s.page or "?"
        chunk = s.chunk_id or "?"
        snippet = _deboilerplate(s.snippet)

        blocks.append(f"[E{i} | {doc} | p.{page} | {chunk}]\n{snippet}")

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
You are an academic research assistant.

Your task is to answer the question using ONLY the provided evidence from multiple documents.

STRICT RULES:
- Do NOT use external knowledge.
- Every important claim MUST be supported by evidence (E#).
- If evidence is weak or incomplete, explicitly say so.
- Do NOT hallucinate or generalize beyond the evidence.

Paper mapping:
{paper_map}

Question:
{question}

Evidence:
{evidence_text}

Return a structured research-style answer in clean Markdown:

## Research Question
Restate the question clearly.

## Short Answer
Provide a 2–4 sentence direct answer based ONLY on the evidence.

## Evidence by Paper
### Paper 1: <name>
- key point with citation (E#)
- key point with citation (E#)

### Paper 2: <name>
- key point with citation (E#)
- key point with citation (E#)

## Cross-Paper Synthesis
Summarize what the documents collectively suggest.

## Disagreements or Differences
- If no direct contradictions exist, describe differences in perspective, emphasis, or focus.
- For example: critical vs optimistic, theoretical vs applied, risks vs benefits.
- Do NOT say "no differences" unless the documents are nearly identical.

## Limitations
- Base this ONLY on evidence.
- Do NOT say "none" unless explicitly justified.
- Consider:
  - missing experimental results
  - lack of empirical validation
  - imbalance in perspectives

Important:
- Use full sentences.
- Do not include empty sections.
- Keep it readable and academic in tone.
""".strip()

    return f"""
You are a research assistant. Answer using ONLY the evidence blocks below.

Rules:
- Do not invent facts not stated in the evidence.
- Cite important claims with evidence labels like (E1), (E2), or (E3).
- Answer the user's question directly and naturally.
- The Short Answer must reflect differences in perspective if present.
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
- Evidence labels like (E1) should only appear at the end of sentences as citations.
- If the question involves totals or calculations, extract all relevant values and compute explicitly. Do not guess.
- Use phrases like "one document", "the other document", or the document names instead.
- When referring to documents, prioritize meaningful descriptions over labels.
- If a concept is not explicitly mentioned in the evidence, do not introduce it.
- When multiple documents are provided, explicitly compare their perspectives (e.g., critical vs optimistic, theoretical vs applied).

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


def _extract_assignment_totals(sources: List[Source]) -> dict[str, int]:
    """
    Extract total assignment points without double-counting.

    Strategy per document:
    1. Combine unique page snippets.
    2. Prefer top-level numbered section totals like:
         1) [20 points total]
         2) [30 points]
       using a regex that does NOT require line-start.
    3. Fall back to rubric TOTAL lines if needed.
    4. Deduplicate repeated totals by (section_number, value).
    """
    from collections import defaultdict

    pages_by_doc: dict[str, list[str]] = defaultdict(list)
    seen_pages = set()

    for s in sources:
        doc = s.doc_id or "unknown_doc"
        page = s.page or -1
        key = (doc, page)
        if key in seen_pages:
            continue
        seen_pages.add(key)

        text = s.snippet or ""
        if text.strip():
            pages_by_doc[doc].append(text)

    by_doc: dict[str, int] = {}

    for doc, page_texts in pages_by_doc.items():
        full_text = "\n".join(page_texts)

        # Normalize whitespace a bit
        normalized = re.sub(r"\s+", " ", full_text)

        # Match top-level numbered sections anywhere in the text, not only line-start.
        # Examples:
        #   1) [20 points total]
        #   2) [30 points]
        top_level_matches = re.findall(
            r"(\d+)\)\s*\[\s*(\d+)\s*(?:points?|pts?)\s*(?:total)?\s*\]",
            normalized,
            flags=re.IGNORECASE,
        )

        # Deduplicate by (section_number, value)
        seen_sections = set()
        top_level_total = 0
        for section_num, value in top_level_matches:
            key = (section_num, value)
            if key in seen_sections:
                continue
            seen_sections.add(key)
            top_level_total += int(value)

        # Fall back to rubric TOTAL lines
        rubric_total_matches = re.findall(
            r"\bTOTAL\s*[:\-]?\s*(\d+)\b",
            normalized,
            flags=re.IGNORECASE,
        )
        rubric_total = sum(int(x) for x in rubric_total_matches)

        # Prefer top-level totals if found; otherwise rubric totals
        if top_level_total > 0:
            by_doc[doc] = top_level_total
        elif rubric_total > 0:
            by_doc[doc] = rubric_total

    return by_doc

def _build_calc_answer(question: str, sources_used: List[Source]) -> str | None:
    filtered_sources = _filter_docs_for_question(question, sources_used)
    totals = _extract_assignment_totals_from_full_docs(filtered_sources)
    if not totals:
        return None

    combined = sum(totals.values())
    parts = [f"- **{doc}**: {totals[doc]} points" for doc in sorted(totals)]

    return "\n".join(
        [
            f"The total points value across the selected documents is **{combined} points**.",
            "",
            "Breakdown:",
            *parts,
        ]
    ).strip()

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

    max_keep = 12 if _is_calc_question(question) else 8
    sources_used = _dedupe_sources(sources, max_keep=max_keep)

    # Deterministic handling for calculation questions
    if _is_calc_question(question):
        calc_answer = _build_calc_answer(question, sources_used)
        if calc_answer:
            citations = [
                Citation(
                    answer_span="Calculated from retrieved scoring sections",
                    source_url=s.url,
                    doc_id=s.doc_id,
                    page=s.page,
                    chunk_id=s.chunk_id,
                )
                for s in sources_used[:6]
            ]

            open_questions = [
                "Do you want a page-by-page score breakdown too?",
                "Should I also show how the total was computed from each document?",
            ]

            return calc_answer, citations, [], open_questions

    normalized_claims = normalize_claims_from_sources(sources_used)
    comparisons = compare_claims(normalized_claims)

    evidence_text = _build_evidence_blocks(sources_used)
    doc_list = _build_doc_list(sources_used)
    doc_count = len(doc_list)
    mode = "structured" if doc_count > 1 else "concise"

    disagreement_hints = "\n".join(
        f"- {comp.aspect}: {comp.doc_a} vs {comp.doc_b}"
        for comp in comparisons[:5]
    )

    prompt = _build_prompt(question,evidence_text + "\n\nKnown differences:\n" + disagreement_hints,doc_list,mode)
    try:
        llm_answer = _call_llm(prompt)
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
    for comp in comparisons[:5]:
        label = "Potential conflict" if comp.comparison_type == "conflict" else "Key difference"
        disagreements.append(
            f"{label} ({comp.aspect}): {comp.doc_a} says '{comp.value_a}', "
            f"while {comp.doc_b} says '{comp.value_b}'. {comp.explanation}"
        )

    open_questions = _build_open_questions(question, mode, sources_used)

    return llm_answer, citations, disagreements, open_questions