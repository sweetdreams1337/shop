import { createContext, ReactNode, useContext, useState } from 'react';
import { api, User } from './api';

type Ctx = {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const s = localStorage.getItem('user');
    return s ? JSON.parse(s) : null;
  });
  const save = (r: { token: string; user: User }) => {
    localStorage.setItem('token', r.token);
    localStorage.setItem('user', JSON.stringify(r.user));
    setUser(r.user);
  };
  return (
    <AuthCtx.Provider
      value={{
        user,
        login: async (email, password) => save(await api('/auth/login', 'POST', { email, password })),
        register: async (name, email, password) => save(await api('/auth/register', 'POST', { name, email, password })),
        logout: () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); },
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
