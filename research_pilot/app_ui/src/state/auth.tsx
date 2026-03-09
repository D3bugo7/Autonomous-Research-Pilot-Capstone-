import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type Session = {
  username: string;
  token: string;
};

type AuthCtx = {
  session: Session | null;
  setSession: (s: Session | null) => void;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);
const KEY = "rp.session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) setSessionState(JSON.parse(raw));
  }, []);

  function setSession(s: Session | null) {
    setSessionState(s);
    if (!s) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(s));
  }

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      setSession,
      logout: () => setSession(null),
    }),
    [session]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}