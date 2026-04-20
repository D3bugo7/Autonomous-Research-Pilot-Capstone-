from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import List, Optional

from app.models import Source


@dataclass
class NormalizedClaim:
    doc_id: str
    page: Optional[int]
    aspect: str
    subject: str
    value: str
    evidence: str
    chunk_id: Optional[str] = None


@dataclass
class ClaimComparison:
    comparison_type: str  # "conflict", "difference", "insufficient_overlap"
    aspect: str
    subject: str
    doc_a: str
    value_a: str
    evidence_a: str
    doc_b: str
    value_b: str
    evidence_b: str
    explanation: str


# ----------------------------
# Helpers
# ----------------------------
def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _contains_any(text: str, keywords: list[str]) -> bool:
    t = text.lower()
    return any(k in t for k in keywords)


def _extract_step_sizes(text: str) -> list[str]:
    # examples: dt=0.001, dt = 0.0001 seconds
    matches = re.findall(r"\bdt\s*=\s*([0-9]*\.?[0-9]+)\b", text, flags=re.IGNORECASE)
    return matches


def _extract_frameworks(text: str) -> list[str]:
    frameworks = []
    lowered = text.lower()

    if "mpi" in lowered:
        frameworks.append("MPI")
    if "openmp" in lowered:
        frameworks.append("OpenMP")
    if "cuda" in lowered:
        frameworks.append("CUDA")

    return frameworks


def _extract_topic(text: str) -> Optional[str]:
    lowered = text.lower()

    if _contains_any(lowered, ["numerical and parallel programming"]):
        return "numerical and parallel programming"
    if _contains_any(lowered, ["linear systems", "series"]):
        return "linear systems and series"
    if _contains_any(lowered, ["integration", "interpolation", "simulation"]):
        return "integration and simulation"
    if _contains_any(lowered, ["spmd", "parallel scaling"]):
        return "spmd and parallel scaling"

    return None


def _extract_subject(text: str) -> str:
    lowered = text.lower()

    if "exercise #4" in lowered or "exercise 4" in lowered:
        return "exercise 4"
    if "exercise #5" in lowered or "exercise 5" in lowered:
        return "exercise 5"
    if "assignment" in lowered:
        return "assignment"

    return "document"


# ----------------------------
# Claim extraction
# ----------------------------
def normalize_claims_from_sources(sources: List[Source]) -> List[NormalizedClaim]:
    claims: List[NormalizedClaim] = []

    for s in sources:
        text = _clean(s.snippet)
        if not text:
            continue

        doc_id = s.doc_id or "unknown_doc"
        page = s.page
        chunk_id = s.chunk_id
        subject = _extract_subject(text)

        topic = _extract_topic(text)
        if topic:
            claims.append(
                NormalizedClaim(
                    doc_id=doc_id,
                    page=page,
                    aspect="topic",
                    subject=subject,
                    value=topic,
                    evidence=text,
                    chunk_id=chunk_id,
                )
            )

        frameworks = _extract_frameworks(text)
        if frameworks:
            claims.append(
                NormalizedClaim(
                    doc_id=doc_id,
                    page=page,
                    aspect="frameworks",
                    subject=subject,
                    value=", ".join(frameworks),
                    evidence=text,
                    chunk_id=chunk_id,
                )
            )

        step_sizes = _extract_step_sizes(text)
        for dt in step_sizes:
            claims.append(
                NormalizedClaim(
                    doc_id=doc_id,
                    page=page,
                    aspect="step_size",
                    subject=subject,
                    value=dt,
                    evidence=text,
                    chunk_id=chunk_id,
                )
            )

        if _contains_any(text, ["velocity", "position", "acceleration profile"]):
            claims.append(
                NormalizedClaim(
                    doc_id=doc_id,
                    page=page,
                    aspect="task",
                    subject=subject,
                    value="compute velocity and position from acceleration profile",
                    evidence=text,
                    chunk_id=chunk_id,
                )
            )

        if _contains_any(text, ["linear systems", "series approximation", "estimate the value of pi"]):
            claims.append(
                NormalizedClaim(
                    doc_id=doc_id,
                    page=page,
                    aspect="task",
                    subject=subject,
                    value="solve linear systems and series approximation in parallel",
                    evidence=text,
                    chunk_id=chunk_id,
                )
            )

    return claims


# ----------------------------
# Comparison logic
# ----------------------------
def compare_claims(claims: List[NormalizedClaim]) -> List[ClaimComparison]:
    comparisons: List[ClaimComparison] = []

    # group by aspect only first
    by_aspect: dict[str, list[NormalizedClaim]] = defaultdict(list)
    for claim in claims:
        by_aspect[claim.aspect].append(claim)

    for aspect, grouped_claims in by_aspect.items():
        # compare only across different documents
        for i in range(len(grouped_claims)):
            for j in range(i + 1, len(grouped_claims)):
                a = grouped_claims[i]
                b = grouped_claims[j]

                if a.doc_id == b.doc_id:
                    continue

                result = _compare_pair(a, b)
                if result:
                    comparisons.append(result)

    return _dedupe_comparisons(comparisons)


def _compare_pair(a: NormalizedClaim, b: NormalizedClaim) -> Optional[ClaimComparison]:
    va = a.value.strip().lower()
    vb = b.value.strip().lower()

    if a.aspect == "topic":
        if va == vb:
            return None
        return ClaimComparison(
            comparison_type="difference",
            aspect=a.aspect,
            subject=f"{a.subject} vs {b.subject}",
            doc_a=a.doc_id,
            value_a=a.value,
            evidence_a=a.evidence,
            doc_b=b.doc_id,
            value_b=b.value,
            evidence_b=b.evidence,
            explanation="The documents emphasize different topics, but this does not necessarily indicate a contradiction.",
        )

    if a.aspect == "frameworks":
        if va == vb:
            return None
        return ClaimComparison(
            comparison_type="difference",
            aspect=a.aspect,
            subject=f"{a.subject} vs {b.subject}",
            doc_a=a.doc_id,
            value_a=a.value,
            evidence_a=a.evidence,
            doc_b=b.doc_id,
            value_b=b.value,
            evidence_b=b.evidence,
            explanation="The documents reference different parallel programming frameworks or combinations of frameworks.",
        )

    if a.aspect == "step_size":
        if va != vb:
            return ClaimComparison(
                comparison_type="difference",
                aspect=a.aspect,
                subject=f"{a.subject} vs {b.subject}",
                doc_a=a.doc_id,
                value_a=a.value,
                evidence_a=a.evidence,
                doc_b=b.doc_id,
                value_b=b.value,
                evidence_b=b.evidence,
                explanation="The documents mention different step sizes. This may reflect different tasks rather than a direct conflict.",
            )
        return None

    if a.aspect == "task":
        if va == vb:
            return None
        return ClaimComparison(
            comparison_type="difference",
            aspect=a.aspect,
            subject=f"{a.subject} vs {b.subject}",
            doc_a=a.doc_id,
            value_a=a.value,
            evidence_a=a.evidence,
            doc_b=b.doc_id,
            value_b=b.value,
            evidence_b=b.evidence,
            explanation="The documents assign different computational tasks, so they differ in scope rather than contradict each other.",
        )

    return None


def _dedupe_comparisons(items: List[ClaimComparison]) -> List[ClaimComparison]:
    seen = set()
    out: List[ClaimComparison] = []

    for item in items:
        key = (
            item.comparison_type,
            item.aspect,
            tuple(sorted([item.doc_a, item.doc_b])),
            tuple(sorted([item.value_a.lower(), item.value_b.lower()])),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(item)

    return out