# Autonomous-Research-Pilot-Capstone-
Think of it as a super-powered research assistant that doesn't just "find" information but actually reads through dozens of documents to summarize findings, spot where authors disagree and prove every claim with a direct citation.

# Research Pilot (MVP)

## Run
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
