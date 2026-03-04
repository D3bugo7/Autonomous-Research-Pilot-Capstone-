import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type Session = { mode: "guest" | "user"; name: string };

type AuthCtx = {
  session: Session | null;
  login: (name: string) => void;
  guest: () => void;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);
const KEY = "rp.session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) setSession(JSON.parse(raw));
  }, []);

  function setAndPersist(s: Session | null) {
    setSession(s);
    if (!s) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(s));
  }

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      login: (name) => setAndPersist({ mode: "user", name }),
      guest: () => setAndPersist({ mode: "guest", name: "Guest" }),
      logout: () => setAndPersist(null),
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