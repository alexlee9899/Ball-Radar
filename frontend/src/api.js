// Lightweight API client. Token kept in localStorage.
// API_BASE is empty for local dev (Vite proxies /api + /uploads to the backend),
// and set to the backend's public URL when frontend & backend are separate services.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'ballradar_token';
const USER_KEY = 'ballradar_user';

// Build an absolute URL for a backend asset (e.g. an uploaded photo at /uploads/..).
export function assetUrl(path) {
  return API_BASE + path;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(path, { method = 'GET', body, formData } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: formData ? formData : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data, status: res.status });
  return data;
}

export const api = {
  register: (b) => request('/api/auth/register', { method: 'POST', body: b }),
  verify: (b) => request('/api/auth/verify', { method: 'POST', body: b }),
  login: (b) => request('/api/auth/login', { method: 'POST', body: b }),
  resend: (b) => request('/api/auth/resend', { method: 'POST', body: b }),
  forgot: (b) => request('/api/auth/forgot', { method: 'POST', body: b }),
  reset: (b) => request('/api/auth/reset', { method: 'POST', body: b }),
  me: () => request('/api/auth/me'),
  courts: () => request('/api/courts'),
  court: (id) => request(`/api/courts/${id}`),
  addCourt: (b) => request('/api/courts', { method: 'POST', body: b }),
  updateCourt: (id, b) => request(`/api/courts/${id}`, { method: 'PUT', body: b }),
  deleteCourt: (id) => request(`/api/courts/${id}`, { method: 'DELETE' }),
  addReview: (id, b) => request(`/api/courts/${id}/reviews`, { method: 'POST', body: b }),
  deleteReview: (id) => request(`/api/courts/${id}/reviews`, { method: 'DELETE' }),
  deletePhoto: (id, photoId) => request(`/api/courts/${id}/photos/${photoId}`, { method: 'DELETE' }),
  uploadPhoto: (id, file) => {
    const fd = new FormData();
    fd.append('photo', file);
    return request(`/api/courts/${id}/photos`, { method: 'POST', formData: fd });
  },
};
