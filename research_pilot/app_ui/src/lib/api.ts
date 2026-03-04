export type ResearchRequest = {
    question: string;
  };
  
  export type Source = {
    title?: string;
    url?: string;
    snippet?: string;
    // keep flexible in case backend evolves
    [key: string]: any;
  };
  
  export type ResearchResponse = {
    question?: string;
    plan?: string[];
    sources?: Source[];
    // keep flexible
    [key: string]: any;
  };
  
  const DEFAULT_BASE_URL = "http://127.0.0.1:8000";
  
  export async function postResearch(
    payload: ResearchRequest,
    baseUrl: string = DEFAULT_BASE_URL
  ): Promise<ResearchResponse> {
    const res = await fetch(`${baseUrl}/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }
  
    return res.json();
  }