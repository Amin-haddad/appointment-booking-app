// File: frontend/src/context/AuthContext.jsx
// SRS References: FR-02 (Page 6), NFR Security (Page 8)
// SRS Section 5 (Page 9): "Functional components with hooks. No SSR."
// React Context for authentication state management — hooks only, no Redux.

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const API_BASE = 'http://localhost:5001/api';

// Axios instance with interceptors for JWT token injection [NFR Security, Page 8]
const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

/**
 * AuthProvider
 * ────────────
 * Wraps the application to provide authentication state via useAuth().
 * Manages: user object, access token (in memory), refresh token (localStorage).
 * Implements automatic token refresh on 401 [SRS Section 8, Risk #2].
 */
export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  // ── Token management ────────────────────────────────────────────────────
  // Access token stored in memory (JS variable) — NOT localStorage [NFR Security]
  // Refresh token stored in localStorage for persistence across page reloads

  const storeTokens = useCallback((access, refresh, userData) => {
  console.log('storeTokens called with:', { access: !!access, refresh: !!refresh, userData });
  setAccessToken(access);
  setUser(userData);
  if (refresh) {
    console.log('Saving refresh token to localStorage');
    localStorage.setItem('refresh_token', refresh);
  } else {
    console.log('No refresh token provided!');
  }
}, []);
  const clearAuth = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem('refresh_token');
  }, []);

  // ── Axios interceptor: inject Authorization header ──────────────────────
  useEffect(() => {
    const requestInterceptor = api.interceptors.request.use(
      (config) => {
        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    return () => api.interceptors.request.eject(requestInterceptor);
  }, [accessToken]);

  // ── Axios interceptor: auto-refresh on 401 ─────────────────────────────
  // SRS Section 8, Risk #2: "refresh token rotation"
  useEffect(() => {
    const responseInterceptor = api.interceptors.response.use(
      (response) => response,
      async (err) => {
        const originalRequest = err.config;

        if (
          err.response?.status === 401 &&
          err.response?.data?.code === 'TOKEN_EXPIRED' &&
          !originalRequest._retry
        ) {
          originalRequest._retry = true;

          try {
            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) {
              clearAuth();
              return Promise.reject(err);
            }

            const { data } = await axios.post(`${API_BASE}/auth/refresh-token`, {
              refresh_token: refreshToken,
            });

            storeTokens(data.access_token, data.refresh_token, user);
            originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
            return api(originalRequest);
          } catch (refreshError) {
            clearAuth();
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(err);
      }
    );

    return () => api.interceptors.response.eject(responseInterceptor);
  }, [accessToken, user, clearAuth, storeTokens]);

  // ── Initialise: attempt token refresh on app load ───────────────────────
  useEffect(() => {
    const initAuth = async () => {
      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        setLoading(false);
        return;
      }

      try {
        const { data } = await axios.post(`${API_BASE}/auth/refresh-token`, {
          refresh_token: refreshToken,
        });

        // Fetch full user profile after token refresh
        const profileResp = await axios.get(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });

        storeTokens(data.access_token, data.refresh_token, profileResp.data.user);
      } catch {
        clearAuth();
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth actions ────────────────────────────────────────────────────────

  /**
   * Register a new user — FR-01
   * @param {{ full_name: string, email: string, password: string }} credentials
   */
  const register = useCallback(async (credentials) => {
    setError(null);
    const { data } = await api.post('/auth/register', credentials);
    return data;
  }, []);

  /**
   * Login — FR-02
   * @param {{ email: string, password: string }} credentials
   */
  const login = useCallback(async (credentials) => {
    setError(null);
    const { data } = await api.post('/auth/login', credentials);
    storeTokens(data.access_token, data.refresh_token, data.user);
    return data;
  }, [storeTokens]);

  /**
   * Logout — revoke refresh token
   */
  const logout = useCallback(async () => {
    try {
      const refreshToken = localStorage.getItem('refresh_token');
      await api.post('/auth/logout', { refresh_token: refreshToken });
    } catch {
      // Logout should always succeed client-side even if server call fails
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  /**
   * Verify email token — FR-01
   * @param {string} token
   */
  const verifyEmail = useCallback(async (token) => {
    const { data } = await api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`);
    return data;
  }, []);

  // ── Context value ───────────────────────────────────────────────────────
  const value = useMemo(() => ({
    user,
    accessToken,
    loading,
    error,
    isAuthenticated: !!user && !!accessToken,
    isAdmin:         user?.role === 'admin',
    isClient:        user?.role === 'client',
    register,
    login,
    logout,
    verifyEmail,
    api,
  }), [user, accessToken, loading, error, register, login, logout, verifyEmail]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth() — custom hook to consume AuthContext.
 * Must be called inside <AuthProvider>.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}

export { api };
export default AuthContext;
