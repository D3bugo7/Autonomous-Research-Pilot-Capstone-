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
    value: str  # stance: "optimistic", "critical", "balanced", "neutral"
    evidence: str
    chunk_id: Optional[str] = None


@dataclass
class ClaimComparison:
    comparison_type: str  # "conflict" or "difference"
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
# Domain-agnostic stance keywords
# ----------------------------
_POSITIVE = {
    "benefit", "benefits", "enhance", "enhances", "improve", "improves",
    "support", "supports", "enable", "enables", "advance", "advances",
    "effective", "effectively", "successful", "success", "positive",
    "advantage", "advantages", "opportunity", "opportunities", "promote",
    "promotes", "strengthen", "strengthens", "facilitate", "facilitates",
    "valuable", "promising", "essential", "necessary", "recommend",
    "encourages", "increase", "increases", "better", "efficient",
    "helpful", "help", "helps", "boost", "boosts", "progress",
    "empower", "empowers", "innovative", "innovation", "solution",
    "solutions", "achieve", "achieves", "gain", "gains", "potential",
    "personalised", "personalized", "adaptive", "engagement", "engages",
    "accuracy", "accurate", "consistent", "saves", "outcomes",
}

_NEGATIVE = {
    "risk", "risks", "challenge", "challenges", "concern", "concerns",
    "limitation", "limitations", "danger", "dangers", "problematic",
    "harmful", "harm", "harms", "threat", "threats", "failure", "failures",
    "ineffective", "obstacle", "obstacles", "barrier", "barriers",
    "undermine", "undermines", "hinder", "hinders", "inadequate",
    "insufficient", "misleading", "uncertain", "unclear", "difficult",
    "difficulty", "problem", "problems", "issue", "issues", "drawback",
    "drawbacks", "weakness", "weaknesses", "oppose", "opposition",
    "controversial", "controversy", "bias", "biased", "flawed",
    "incomplete", "missing", "lack", "lacking", "absent", "neglect",
    "inequality", "injustice", "inequity", "exacerbate", "exacerbates",
    "misuse", "misuses", "abuse", "exploit", "exploits", "dehumanise",
    "dehumanize", "dystopian", "caution", "cautious", "restrictive",
    "marginalised", "marginalized", "dystopia", "dystopian", "shallow",
    "reduced", "diminished", "worse", "struggle", "worsen",
}

_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "used",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "up",
    "about", "into", "through", "during", "before", "after", "above",
    "below", "between", "out", "off", "over", "under", "again", "further",
    "then", "once", "and", "but", "or", "nor", "not", "so", "yet",
    "both", "either", "neither", "each", "this", "that", "these", "those",
    "it", "its", "they", "them", "their", "we", "our", "you", "your",
    "he", "she", "his", "her", "who", "which", "what", "when", "where",
    "how", "why", "all", "any", "few", "more", "most", "other", "some",
    "such", "only", "same", "than", "too", "very", "just", "also", "as",
    "if", "while", "although", "because", "since", "unless", "however",
    "therefore", "thus", "hence", "moreover", "furthermore", "nevertheless",
    "nonetheless", "instead", "rather", "whether", "paper", "study",
    "research", "document", "article", "text", "authors", "author",
    "work", "provide", "provides", "suggest", "suggests", "note", "notes",
    "show", "shows", "discuss", "discusses", "include", "includes", "use",
    "uses", "based", "many", "new", "including", "current", "given",
    "key", "via", "within", "across", "among", "well", "also", "even",
    "like", "make", "made", "take", "taken", "given", "example",
    "approach", "approaches", "result", "results", "data", "analysis",
    "using", "used", "these", "those", "here", "there", "their",
}


# ----------------------------
# Helpers
# ----------------------------
def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _get_stance(text: str) -> str:
    """Classify text stance as optimistic, critical, balanced, or neutral."""
    words = set(re.findall(r"\b\w+\b", text.lower()))
    pos = len(words & _POSITIVE)
    neg = len(words & _NEGATIVE)

    if pos == 0 and neg == 0:
        return "neutral"
    if pos > neg:
        return "optimistic"
    if neg > pos:
        return "critical"
    return "balanced"


def _extract_topics(text: str, top_n: int = 3) -> list[str]:
    """Extract the top N meaningful content words as topic tags."""
    words = re.findall(r"\b[a-z]{4,}\b", text.lower())
    freq: dict[str, int] = defaultdict(int)
    for w in words:
        if w not in _STOPWORDS:
            freq[w] += 1

    sorted_words = sorted(freq.items(), key=lambda x: -x[1])
    return [w for w, _ in sorted_words[:top_n]]


def _majority_stance(stances: list[str]) -> str:
    if not stances:
        return "neutral"
    counts: dict[str, int] = defaultdict(int)
    for s in stances:
        counts[s] += 1
    return max(counts, key=lambda k: counts[k])


# ----------------------------
# Claim extraction (domain-agnostic)
# ----------------------------
def normalize_claims_from_sources(sources: List[Source]) -> List[NormalizedClaim]:
    claims: List[NormalizedClaim] = []

    for s in sources:
        text = _clean(s.snippet)
        if not text or len(text) < 50:
            continue

        doc_id = s.doc_id or "unknown_doc"
        stance = _get_stance(text)
        topics = _extract_topics(text, top_n=3)

        for topic in topics:
            claims.append(
                NormalizedClaim(
                    doc_id=doc_id,
                    page=s.page,
                    aspect=topic,
                    subject=topic,
                    value=stance,
                    evidence=text[:300],
                    chunk_id=s.chunk_id,
                )
            )

    return claims


# ----------------------------
# Comparison logic
# ----------------------------
def compare_claims(claims: List[NormalizedClaim]) -> List[ClaimComparison]:
    if not claims:
        return []

    # Aggregate stance + evidence per (aspect, doc)
    by_aspect: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    evidence_by: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

    for c in claims:
        by_aspect[c.aspect][c.doc_id].append(c.value)
        evidence_by[c.aspect][c.doc_id].append(c.evidence)

    comparisons: List[ClaimComparison] = []

    for aspect, doc_stances in by_aspect.items():
        docs = list(doc_stances.keys())
        if len(docs) < 2:
            continue

        for i in range(len(docs)):
            for j in range(i + 1, len(docs)):
                da, db = docs[i], docs[j]
                stance_a = _majority_stance(doc_stances[da])
                stance_b = _majority_stance(doc_stances[db])

                # Only surface meaningful differences — skip if same or both neutral
                if stance_a == stance_b:
                    continue
                if stance_a == "neutral" and stance_b == "neutral":
                    continue

                is_conflict = (
                    (stance_a == "optimistic" and stance_b == "critical")
                    or (stance_a == "critical" and stance_b == "optimistic")
                )

                ev_a = evidence_by[aspect][da][0] if evidence_by[aspect][da] else ""
                ev_b = evidence_by[aspect][db][0] if evidence_by[aspect][db] else ""

                label_a = _stance_label(stance_a)
                label_b = _stance_label(stance_b)

                explanation = (
                    f"On the topic of '{aspect}', {da} takes a {label_a} stance "
                    f"while {db} takes a {label_b} stance."
                )

                comparisons.append(
                    ClaimComparison(
                        comparison_type="conflict" if is_conflict else "difference",
                        aspect=aspect,
                        subject=aspect,
                        doc_a=da,
                        value_a=stance_a,
                        evidence_a=ev_a,
                        doc_b=db,
                        value_b=stance_b,
                        evidence_b=ev_b,
                        explanation=explanation,
                    )
                )

    return _dedupe_comparisons(comparisons)[:8]


def _stance_label(stance: str) -> str:
    labels = {
        "optimistic": "optimistic / supportive",
        "critical": "critical / cautionary",
        "balanced": "balanced / mixed",
        "neutral": "neutral",
    }
    return labels.get(stance, stance)


def _dedupe_comparisons(items: List[ClaimComparison]) -> List[ClaimComparison]:
    seen: set[tuple] = set()
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
