import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('ctem_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (res) => {
    const contentType = String(res.headers?.['content-type'] || '');
    if (contentType.includes('text/html')) {
      return Promise.reject(new Error('API returned HTML instead of JSON'));
    }
    return res;
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ctem_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export default apiClient;
