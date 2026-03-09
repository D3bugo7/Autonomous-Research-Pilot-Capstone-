export type UploadResponse = { doc_id: string; filename?: string };
export type DocumentListItem = { doc_id: string; filename: string };

export type ResearchRequest = {
  question: string;
  doc_ids?: string[]; 
};

export type Source = {
  title?: string;
  url?: string;
  snippet?: string;
  doc_id?: string;
  page?: number;
  chunk_id?: string;
  [key: string]: any;
};

export type ResearchResponse = {
  question?: string;
  answer?: string;
  plan?: string[];
  sources?: Source[];
  [key: string]: any;
};

export type AuthResponse = {
  access_token: string;
  token_type: "bearer";
  username: string;
};

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function stripSlash(u: string) {
  return u.trim().replace(/\/+$/, "");
}

async function checkedJson(res: Response, label: string) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${label} failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

// ---- AUTH ----
export async function registerUser(baseUrl: string, username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${stripSlash(baseUrl)}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return checkedJson(res, "Register");
}

export async function loginUser(baseUrl: string, username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${stripSlash(baseUrl)}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return checkedJson(res, "Login");
}

// ---- DOCS ----
export async function uploadPdf(baseUrl: string, token: string, file: File): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(`${stripSlash(baseUrl)}/documents`, {
    method: "POST",
    headers: { ...authHeaders(token) },
    body: fd,
  });

  return checkedJson(res, "Upload");
}

export async function listDocuments(baseUrl: string, token: string): Promise<DocumentListItem[]> {
  const res = await fetch(`${stripSlash(baseUrl)}/documents`, {
    method: "GET",
    headers: { ...authHeaders(token) },
  });
  return checkedJson(res, "List documents");
}

// ---- RESEARCH ----
export async function postResearch(baseUrl: string, token: string, payload: ResearchRequest): Promise<ResearchResponse> {
  const res = await fetch(`${stripSlash(baseUrl)}/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  return checkedJson(res, "Research");
}

// ---DELETE DOC---
export async function deleteDocument(baseUrl: string, token: string, docId: string) {
  const resp = await fetch(`${baseUrl}/documents/${encodeURIComponent(docId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `Delete failed (${resp.status})`);
  }
  return resp.json();
}