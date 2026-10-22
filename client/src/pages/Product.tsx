import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, Product, vnd } from '../api';
import { useAuth } from '../auth';
import ProductCard, { Stars } from './ProductCard';

type Detail = Product & { reviewList: { id: number; rating: number; comment: string; user_name: string; created_at: string }[] };

export default function ProductPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [p, setP] = useState<Detail | null>(null);
  const [recs, setRecs] = useState<Product[]>([]);
  const [qty, setQty] = useState(1);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => api(`/products/${id}`).then(setP).catch((e) => setErr(e.message));
  useEffect(() => {
    setMsg(''); setErr(''); setQty(1);
    load();
    api(`/recommendations?productId=${id}`).then(setRecs).catch(() => {});
  }, [id]);

  const add = async () => {
    if (!user) return nav('/login');
    setMsg(''); setErr('');
    try { await api('/cart', 'POST', { productId: Number(id), quantity: qty }); setMsg('Đã thêm vào giỏ hàng'); }
    catch (e: any) { setErr(e.message); }
  };

  const review = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(''); setErr('');
    try { await api(`/products/${id}/reviews`, 'POST', { rating, comment }); setComment(''); setMsg('Đã gửi đánh giá'); load(); }
    catch (e: any) { setErr(e.message); }
  };

  if (!p) return <p className={err ? 'err' : ''}>{err || 'Đang tải...'}</p>;
  return (
    <>
      <div className="box detail">
        <img src={p.image_url} alt={p.name} />
        <div>
          <h2>{p.name}</h2>
          <span className="badge">{p.category_name}</span>
          <p className="price" style={{ fontSize: 22 }}>{vnd(p.price)}</p>
          <Stars r={p.rating} n={p.reviews} />
          <p>{p.description}</p>
          <p>Tồn kho: {p.stock}</p>
          {p.stock > 0 ? (
            <>
              <input type="number" min={1} max={p.stock} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: 70 }} />{' '}
              <button onClick={add}>Thêm vào giỏ</button>
            </>
          ) : <p className="err">Hết hàng</p>}
          {msg && <p className="ok">{msg}</p>}
          {err && <p className="err">{err}</p>}
        </div>
      </div>

      <div className="box">
        <h3>Đánh giá ({p.reviewList.length})</h3>
        {user ? (
          <form className="form" onSubmit={review}>
            <label>Số sao:{' '}
              <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
              </select>
            </label>
            <textarea rows={3} placeholder="Nhận xét của bạn" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
            <button>Gửi đánh giá</button>
          </form>
        ) : <p>Vui lòng đăng nhập để đánh giá.</p>}
        {p.reviewList.map((r) => (
          <div key={r.id} style={{ borderTop: '1px solid #eee', marginTop: 10, paddingTop: 8 }}>
            <b>{r.user_name}</b> <span className="stars">{'★'.repeat(r.rating)}</span>
            <div>{r.comment}</div>
          </div>
        ))}
      </div>

      {recs.length > 0 && (
        <>
          <h3>Sản phẩm tương tự / có thể bạn thích</h3>
          <div className="grid">{recs.slice(0, 4).map((x) => <ProductCard key={x.id} p={x} />)}</div>
        </>
      )}
    </>
  );
}
