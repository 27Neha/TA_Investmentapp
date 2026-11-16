import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokens } from '../api/client';

interface Ctx { ready: boolean; signedIn: boolean; login(email: string, password: string): Promise<void>; logout(): Promise<void> }
const AuthContext = createContext<Ctx>({ ready: false, signedIn: false, login: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    (async () => {
      // Session recovery: a stored token only counts if the server accepts it (or refreshes it).
      try { if (await tokens.access()) { await api('/v1/auth/me', { auth: true }); setSignedIn(true); } } catch { setSignedIn(false); }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ accessToken: string; refreshToken: string }>('/v1/auth/login', { body: { email, password } });
    await tokens.save(r.accessToken, r.refreshToken);
    setSignedIn(true);
  }, []);

  const logout = useCallback(async () => {
    const rt = await tokens.refresh();
    if (rt) await api('/v1/auth/logout', { body: { refreshToken: rt } }).catch(() => undefined);
    await tokens.clear();
    setSignedIn(false);
  }, []);

  const value = useMemo(() => ({ ready, signedIn, login, logout }), [ready, signedIn, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
