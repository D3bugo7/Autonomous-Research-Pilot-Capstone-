from pathlib import Path
from typing import List, Dict, Any
from pypdf import PdfReader


def load_pdf(path: str | Path) -> Dict[str, Any]:
    """
    Loads a PDF and returns:
      {
        "doc_id": <filename without extension>,
        "path": <full path>,
        "pages": [{"page": 1, "text": "..."}, ...],
        "text": <full concatenated text>
      }
    """
    p = Path(path)
    reader = PdfReader(str(p))

    pages: List[Dict[str, Any]] = []
    all_text_parts: List[str] = []

    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        text = text.replace("\x00", "").strip()
        pages.append({"page": i + 1, "text": text})
        if text:
            all_text_parts.append(text)

    return {
        "doc_id": p.stem,
        "path": str(p),
        "pages": pages,
        "text": "\n".join(all_text_parts),
    }


def load_pdfs_from_dir(dir_path: str | Path) -> List[Dict[str, Any]]:
    """
    Loads all PDFs from a directory.
    """
    d = Path(dir_path)
    return [load_pdf(pdf) for pdf in sorted(d.glob("*.pdf"))]
