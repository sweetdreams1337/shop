import { FormEvent, useEffect, useState } from 'react';
import { api, Product, vnd } from '../api';
import { STATUS } from './Orders';

type Tab = 'products' | 'orders' | 'users';
const empty = { name: '', description: '', price: 0, stock: 0, image_url: '', category_id: 0 };

export default function Admin() {
  const [tab, setTab] = useState<Tab>('products');
  const [err, setErr] = useState('');
  return (
    <>
      <h2>Quản trị</h2>
      <div className="tabs">
        {(['products', 'orders', 'users'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setErr(''); }}>
            {{ products: 'Sản phẩm', orders: 'Đơn hàng', users: 'Người dùng' }[t]}
          </button>
        ))}
      </div>
      {err && <p className="err">{err}</p>}
      {tab === 'products' && <Products setErr={setErr} />}
      {tab === 'orders' && <OrdersTab setErr={setErr} />}
      {tab === 'users' && <UsersTab setErr={setErr} />}
    </>
  );
}

type P = { setErr: (s: string) => void };

function Products({ setErr }: P) {
  const [list, setList] = useState<Product[]>([]);
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [f, setF] = useState<any>(empty);
  const [editId, setEditId] = useState<number | null>(null);

  const load = () => api('/products?page=1').then(async (r) => {
    // lấy hết các trang
    let all = r.items;
    for (let p = 2; p <= r.pages; p++) all = all.concat((await api(`/products?page=${p}`)).items);
    setList(all);
  }).catch((e) => setErr(e.message));
  useEffect(() => { load(); api('/categories').then((c) => { setCats(c); setF((x: any) => ({ ...x, category_id: c[0]?.id ?? 0 })); }); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      if (editId) await api(`/products/${editId}`, 'PUT', f); else await api('/products', 'POST', f);
      setF({ ...empty, category_id: cats[0]?.id ?? 0 }); setEditId(null); load();
    } catch (e: any) { setErr(e.message); }
  };
  const del = async (id: number) => {
    if (!confirm('Xoá sản phẩm?')) return;
    setErr('');
    try { await api(`/products/${id}`, 'DELETE'); load(); } catch (e: any) { setErr(e.message); }
  };
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <form className="box" onSubmit={submit}>
        <h3>{editId ? `Sửa sản phẩm #${editId}` : 'Thêm sản phẩm'}</h3>
        <div className="row-form">
          <input placeholder="Tên" value={f.name} onChange={set('name')} required />
          <input type="number" min={0} placeholder="Giá" value={f.price} onChange={set('price')} required />
          <input type="number" min={0} placeholder="Tồn kho" value={f.stock} onChange={set('stock')} required />
          <select value={f.category_id} onChange={set('category_id')}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input placeholder="URL hình ảnh" value={f.image_url} onChange={set('image_url')} />
          <input placeholder="Mô tả" value={f.description} onChange={set('description')} />
        </div>
        <button>{editId ? 'Cập nhật' : 'Thêm'}</button>{' '}
        {editId && <button type="button" className="sec" onClick={() => { setEditId(null); setF({ ...empty, category_id: cats[0]?.id ?? 0 }); }}>Huỷ sửa</button>}
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Tên</th><th>Danh mục</th><th>Giá</th><th>Kho</th><th></th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td><td>{p.name}</td><td>{p.category_name}</td><td>{vnd(p.price)}</td><td>{p.stock}</td>
                <td>
                  <button onClick={() => { setEditId(p.id); setF({ name: p.name, description: p.description, price: p.price, stock: p.stock, image_url: p.image_url, category_id: p.category_id }); window.scrollTo(0, 0); }}>Sửa</button>{' '}
                  <button className="danger" onClick={() => del(p.id)}>Xoá</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OrdersTab({ setErr }: P) {
  const [list, setList] = useState<any[]>([]);
  const load = () => api('/admin/orders').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const change = async (id: number, status: string) => {
    setErr('');
    try { await api(`/admin/orders/${id}/status`, 'PUT', { status }); load(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Khách hàng</th><th>Sản phẩm</th><th>Tổng</th><th>Giao tới</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {list.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.user_name}<br /><small>{o.email}</small></td>
              <td>{o.items.map((i: any) => <div key={i.product_id}>{i.name} × {i.quantity}</div>)}</td>
              <td>{vnd(o.total)}</td>
              <td>{o.address}<br />{o.phone}</td>
              <td>
                <select value={o.status} onChange={(e) => change(o.id, e.target.value)}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersTab({ setErr }: P) {
  const [list, setList] = useState<any[]>([]);
  const load = () => api('/admin/users').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const act = async (p: Promise<any>) => { setErr(''); try { await p; load(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Tên</th><th>Email</th><th>Quyền</th><th></th></tr></thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.id}>
              <td>{u.id}</td><td>{u.name}</td><td>{u.email}</td>
              <td>
                <select value={u.role} onChange={(e) => act(api(`/admin/users/${u.id}/role`, 'PUT', { role: e.target.value }))}>
                  <option value="user">user</option><option value="admin">admin</option>
                </select>
              </td>
              <td><button className="danger" onClick={() => confirm('Xoá người dùng?') && act(api(`/admin/users/${u.id}`, 'DELETE'))}>Xoá</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
