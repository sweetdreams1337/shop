const BASE = import.meta.env.VITE_API_URL || '/api';

export type User = { id: number; name: string; email: string; role: 'user' | 'admin' };
export type Product = {
  id: number; name: string; description: string; price: number; stock: number;
  image_url: string; category_id: number; category_name: string; rating: number; reviews: number;
};

export const vnd = (n: number) => n.toLocaleString('vi-VN') + ' ₫';

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = localStorage.getItem('token');
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra');
  return data as T;
}
