const base = import.meta.env.VITE_API_BASE || '/api/v1';
let csrf;
let csrfPromise;
export class ApiError extends Error {
  constructor(error, status) {
    super(error?.message || 'The request could not be completed.');
    this.code = error?.code;
    this.details = error?.details;
    this.status = status;
  }
}
export async function api(path, options = {}) {
  const method = options.method || 'GET';
  if (!['GET', 'HEAD'].includes(method) && !csrf) {
    csrfPromise ??= fetch(`${base}/auth/csrf`, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Unable to establish a secure connection.');
        csrf = (await r.json()).data.token;
      })
      .finally(() => {
        csrfPromise = null;
      });
    await csrfPromise;
  }
  const response = await fetch(`${base}${path}`, {
    ...options,
    method,
    credentials: 'include',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(method) ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !['/auth/login', '/auth/me'].includes(path))
      window.dispatchEvent(new Event('examledger:session-expired'));
    if (payload.error?.code === 'CSRF_REJECTED') csrf = null;
    throw new ApiError(payload.error, response.status);
  }
  return payload.data;
}
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
}
export const localDateValue = (value) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
