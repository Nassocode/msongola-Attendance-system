const API_BASE = 'http://localhost:3000/api';

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Could not reach the attendance API at ${API_BASE}. Check that the backend is running and allows this frontend origin.`);
    }
    throw error;
  }
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

window.api = {
  get: (path) => apiRequest(path),
  post: (path, data) => apiRequest(path, { method: 'POST', body: JSON.stringify(data) }),
  put: (path, data) => apiRequest(path, { method: 'PUT', body: JSON.stringify(data) }),
  patch: (path, data) => apiRequest(path, { method: 'PATCH', body: JSON.stringify(data) })
};