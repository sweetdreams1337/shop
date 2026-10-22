import { Link } from 'react-router-dom';
import { Product, vnd } from '../api';

export const Stars = ({ r, n }: { r: number; n: number }) => (
  <span className="stars">{n ? `★ ${r} (${n})` : '☆ Chưa có đánh giá'}</span>
);

export default function ProductCard({ p }: { p: Product }) {
  return (
    <div className="card">
      <Link to={`/product/${p.id}`}><img src={p.image_url} alt={p.name} /></Link>
      <Link to={`/product/${p.id}`}><b>{p.name}</b></Link>
      <span className="badge">{p.category_name}</span>
      <span className="price">{vnd(p.price)}</span>
      <Stars r={p.rating} n={p.reviews} />
      {p.stock === 0 && <span className="err">Hết hàng</span>}
    </div>
  );
}
