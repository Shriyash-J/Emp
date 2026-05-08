import { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

function loadFromStorage() {
  try {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) return { token, user: JSON.parse(userStr) };
  } catch { /* corrupted */ }
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  return { token: null, user: null };
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(loadFromStorage);

  const loginUser = (userData, tokenStr) => {
    localStorage.setItem('token', tokenStr);
    localStorage.setItem('user', JSON.stringify(userData));
    setAuth({ token: tokenStr, user: userData });
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setAuth({ token: null, user: null });
  };

  return (
    <AuthContext.Provider value={{ user: auth.user, token: auth.token, loginUser, logout, isAuthenticated: !!auth.token && !!auth.user }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
