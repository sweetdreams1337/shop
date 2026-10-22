import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, vnd } from '../api';

type Item = { id: number; product_id: number; quantity: number; name: string; price: number; stock: number; image_url: string };

export default function Cart() {
  const [items, setItems] = useState<Item[]>([]);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const nav = useNavigate();

  useEffect(() => { api('/cart').then(setItems).catch((e) => setErr(e.message)); }, []);

  const run = async (p: Promise<Item[]>) => { setErr(''); try { setItems(await p); } catch (e: any) { setErr(e.message); } };
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);

  const order = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try { await api('/orders', 'POST', { address, phone }); nav('/orders'); }
    catch (e: any) { setErr(e.message); }
  };

  if (!items.length) return <><h2>Giỏ hàng</h2>{err && <p className="err">{err}</p>}<p>Giỏ hàng trống. <Link to="/">Tiếp tục mua sắm</Link></p></>;
  return (
    <>
      <h2>Giỏ hàng</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Sản phẩm</th><th>Đơn giá</th><th>Số lượng</th><th>Thành tiền</th><th></th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td><Link to={`/product/${i.product_id}`}>{i.name}</Link></td>
                <td>{vnd(i.price)}</td>
                <td>
                  <input type="number" min={1} max={i.stock} value={i.quantity} style={{ width: 70 }}
                    onChange={(e) => { const q = Number(e.target.value); if (q >= 1) run(api(`/cart/${i.product_id}`, 'PUT', { quantity: q })); }} />
                </td>
                <td>{vnd(i.price * i.quantity)}</td>
                <td><button className="danger" onClick={() => run(api(`/cart/${i.product_id}`, 'DELETE'))}>Xoá</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Tổng: <span className="price">{vnd(total)}</span></h3>
      <form className="box form" onSubmit={order}>
        <h3>Thông tin đặt hàng (thanh toán khi nhận hàng)</h3>
        <input placeholder="Địa chỉ giao hàng" value={address} onChange={(e) => setAddress(e.target.value)} required />
        <input placeholder="Số điện thoại" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        {err && <p className="err">{err}</p>}
        <button>Đặt hàng</button>
      </form>
    </>
  );
}
