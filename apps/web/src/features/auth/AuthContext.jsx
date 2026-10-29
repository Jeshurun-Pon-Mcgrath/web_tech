import { createContext, useContext, useEffect, useState } from 'react';
import { api, post } from '../../lib/api';
const Context = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    const invalidate = () => {
      setUser(null);
      setSessionExpired(true);
    };
    window.addEventListener('examledger:session-expired', invalidate);
    return () => window.removeEventListener('examledger:session-expired', invalidate);
  }, []);
  useEffect(() => {
    api('/auth/me')
      .then(setUser)
      .catch((err) => {
        if (err.status !== 401) setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);
  const login = async (credentials) => {
    const u = await post('/auth/login', credentials);
    setUser(u);
    setSessionExpired(false);
    return u;
  };
  const logout = async () => {
    await post('/auth/logout');
    setUser(null);
  };
  return (
    <Context.Provider
      value={{
        user,
        loading,
        error,
        login,
        logout,
        sessionExpired,
        clearUser: () => setUser(null),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
