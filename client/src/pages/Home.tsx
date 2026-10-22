import { useEffect, useState } from 'react';
import { api, Product } from '../api';
import ProductCard from './ProductCard';

export default function Home() {
  const [items, setItems] = useState<Product[]>([]);
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [recs, setRecs] = useState<Product[]>([]);
  const [kw, setKw] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/categories').then(setCats).catch((e) => setErr(e.message));
    api('/recommendations').then(setRecs).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ page: String(page) });
      if (kw) qs.set('q', kw);
      if (cat) qs.set('category', cat);
      if (sort) qs.set('sort', sort);
      api(`/products?${qs}`).then((r) => { setItems(r.items); setPages(r.pages); }).catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [kw, cat, sort, page]);

  return (
    <>
      {recs.length > 0 && (
        <section>
          <h2>✨ Gợi ý cho bạn</h2>
          <div className="grid">{recs.slice(0, 4).map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </section>
      )}
      <h2>Tất cả sản phẩm</h2>
      <div className="toolbar">
        <input placeholder="Tìm kiếm sản phẩm..." value={kw} onChange={(e) => { setKw(e.target.value); setPage(1); }} />
        <select value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }}>
          <option value="">Tất cả danh mục</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
          <option value="">Mới nhất</option>
          <option value="price_asc">Giá tăng dần</option>
          <option value="price_desc">Giá giảm dần</option>
        </select>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="grid">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      {items.length === 0 && <p>Không có sản phẩm phù hợp.</p>}
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Trước</button>
        <span>Trang {page}/{pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau ›</button>
      </div>
    </>
  );
}
