import { useEffect, useState } from 'react';
import { api, vnd } from '../api';

export const STATUS: Record<string, string> = {
  pending: 'Chờ xử lý', processing: 'Đang xử lý', shipping: 'Đang giao', completed: 'Hoàn thành', cancelled: 'Đã huỷ',
};

export default function Orders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const load = () => api('/orders').then(setOrders).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const cancel = async (id: number) => {
    if (!confirm('Huỷ đơn hàng này?')) return;
    try { await api(`/orders/${id}/cancel`, 'PUT'); load(); } catch (e: any) { setErr(e.message); }
  };

  return (
    <>
      <h2>Đơn hàng của tôi</h2>
      {err && <p className="err">{err}</p>}
      {orders.length === 0 && <p>Chưa có đơn hàng.</p>}
      {orders.map((o) => (
        <div className="box" key={o.id}>
          <b>Đơn #{o.id}</b> – {new Date(o.created_at).toLocaleString('vi-VN')} – <span className="badge">{STATUS[o.status]}</span>
          <ul>{o.items.map((i: any) => <li key={i.product_id}>{i.name} × {i.quantity} – {vnd(i.price * i.quantity)}</li>)}</ul>
          <div>Giao tới: {o.address} – {o.phone}</div>
          <div>Tổng: <span className="price">{vnd(o.total)}</span></div>
          {o.status === 'pending' && <button className="danger" onClick={() => cancel(o.id)}>Huỷ đơn</button>}
        </div>
      ))}
    </>
  );
}
