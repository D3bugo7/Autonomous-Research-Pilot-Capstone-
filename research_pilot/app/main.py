from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app import state
import os, shutil
from app.skills.research.retriever import retrieve_sources
from app.skills.research.reader import extract_claims
from app.skills.research.synthesizer import synthesize_answer
from fastapi import Path as FastAPIPath
from app.db import init_db, get_db, User, Document
from app.auth import hash_pw, verify_pw, create_access_token, get_current_user_id
from pathlib import Path
 
UPLOAD_ROOT = Path(__file__).resolve().parent / "user_uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI()

frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        frontend_origin,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
init_db()


# -------- AUTH --------
class RegisterReq(BaseModel):
    username: str
    password: str

class LoginReq(BaseModel):
    username: str
    password: str

@app.post("/auth/register")
def register(req: RegisterReq, db: Session = Depends(get_db)):
    u = req.username.strip()
    if len(u) < 3:
        raise HTTPException(400, "Username too short")
    if len(req.password) < 6:
        raise HTTPException(400, "Password too short")

    existing = db.query(User).filter(User.username == u).first()
    if existing:
        raise HTTPException(409, "Username already exists")

    user = User(username=u, password_hash=hash_pw(req.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": user.id, "username": user.username})
    return {"access_token": token, "token_type": "bearer", "username": user.username}

@app.post("/auth/login")
def login(req: LoginReq, db: Session = Depends(get_db)):
    u = req.username.strip()
    user = db.query(User).filter(User.username == u).first()
    if not user or not verify_pw(req.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")

    token = create_access_token({"sub": user.id, "username": user.username})
    return {"access_token": token, "token_type": "bearer", "username": user.username}

# -------- DOCUMENTS --------
@app.post("/documents")
async def upload_document(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if file.content_type != "application/pdf":
        raise HTTPException(400, "Only PDFs supported")

    user_dir = UPLOAD_ROOT / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    doc = Document(user_id=user_id, filename=file.filename or "upload.pdf", path="")
    db.add(doc)
    db.commit()
    db.refresh(doc)


    safe_name = (doc.filename or "upload.pdf").replace("/", "_")
    if not safe_name.lower().endswith(".pdf"):
        safe_name += ".pdf"
    disk_name = f"{doc.id}__{safe_name}"
    save_path = user_dir / disk_name

    with open(save_path, "wb") as out:
        shutil.copyfileobj(file.file, out)

    doc.path = str(save_path)
    db.commit()

    return {"doc_id": doc.id, "filename": doc.filename}

@app.get("/documents")
def list_documents(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    docs = db.query(Document).filter(Document.user_id == user_id).order_by(Document.created_at.desc()).all()
    return [{"doc_id": d.id, "filename": d.filename} for d in docs]

# -------- RESEARCH --------
class ResearchReq(BaseModel):
    question: str
    doc_ids: list[str] = []

@app.post("/research")
async def research(
    req: ResearchReq,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    
    if not req.doc_ids:
        raise HTTPException(400, "No documents selected. Upload a PDF first.")

    # fetch docs owned by THIS user only
    docs = (
        db.query(Document)
        .filter(Document.user_id == user_id)
        .filter(Document.id.in_(req.doc_ids))
        .all()
    )
    if not docs:
        raise HTTPException(400, "No matching documents for this user.")


    # CRITICAL: retrieval must ONLY search within doc_paths.
    # Replace this with your existing pipeline call:
    
    allowed_paths = [d.path for d in docs]
    user_dir = UPLOAD_ROOT / user_id

    sources = retrieve_sources(
        req.question,
        user_dir=user_dir,
        allowed_paths=allowed_paths,
    )
    claims = extract_claims(req.question, sources)
    answer, citations, disagreements, open_qs = synthesize_answer(req.question, sources, claims)    

    result = {
        "question": req.question,
        "plan": [ 
            "Retrieve relevant passages from selected PDFs", 
            "Extract claims and supporting evidence", 
            "Synthesize a citation-grounded answer", 
            ],
        "sources": [s.model_dump() for s in sources],
        "claims": [c.model_dump() for c in claims],
        "answer": answer,
        "citations": [c.model_dump() if hasattr(c, "model_dump") else dict(c) for c in citations],
        "disagreements": disagreements,
    }
    return result


@app.delete("/documents/{doc_id}")
def delete_document(
    doc_id: str = FastAPIPath(...),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    doc = (
        db.query(Document)
        .filter(Document.id == doc_id)
        .filter(Document.user_id == user_id)
        .first()
    )
    if not doc:
        raise HTTPException(404, "Document not found")

    # delete file from disk
    try:
        if doc.path and os.path.exists(doc.path):
            os.remove(doc.path)
    except Exception:
        # don't fail the whole request if file deletion fails
        pass

    # delete DB record
    db.delete(doc)
    db.commit()

    return {"ok": True, "doc_id": doc_id}

@app.get("/health")
def health():
    return {"ok": True}