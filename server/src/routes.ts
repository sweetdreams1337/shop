import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q } from './db';
import { adminOnly, auth, sign, uid } from './auth';
import { chatReply } from './chatbot';

export const api = Router();

const h = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);
const fail = (res: Response, code: number, error: string) => res.status(code).json({ error });
const num = (v: any) => Number(v);

// ================= AUTH =================
const registerSchema = z.object({
  name: z.string().trim().min(2, 'Tên tối thiểu 2 ký tự').max(100),
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự').max(100),
});

api.post('/auth/register', h(async (req, res) => {
  const d = registerSchema.parse(req.body);
  if ((await q('SELECT id FROM users WHERE email=$1', [d.email])).length) return fail(res, 409, 'Email đã được đăng ký');
  const [u] = await q('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role', [
    d.name, d.email, bcrypt.hashSync(d.password, 10), 'user',
  ]);
  res.status(201).json({ token: sign(u), user: u });
}));

api.post('/auth/login', h(async (req, res) => {
  const d = z.object({ email: z.string().trim().toLowerCase().email('Email không hợp lệ'), password: z.string().min(1) }).parse(req.body);
  const [u] = await q('SELECT * FROM users WHERE email=$1', [d.email]);
  if (!u || !bcrypt.compareSync(d.password, u.password_hash)) return fail(res, 401, 'Sai email hoặc mật khẩu');
  res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));

// ================= PRODUCTS =================
async function ratingMap() {
  const rows = await q('SELECT product_id, AVG(rating) AS avg, COUNT(*) AS cnt FROM reviews GROUP BY product_id');
  const m = new Map<number, { rating: number; reviews: number }>();
  rows.forEach((r) => m.set(r.product_id, { rating: Math.round(num(r.avg) * 10) / 10, reviews: num(r.cnt) }));
  return m;
}
const withRating = (list: any[], m: Map<number, any>) =>
  list.map((p) => ({ ...p, rating: m.get(p.id)?.rating ?? 0, reviews: m.get(p.id)?.reviews ?? 0 }));

api.get('/categories', h(async (_req, res) => res.json(await q('SELECT * FROM categories ORDER BY id'))));

api.get('/products', h(async (req, res) => {
  const { q: kw, category, sort } = req.query as Record<string, string>;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = 12;
  const where: string[] = [];
  const params: any[] = [];
  if (kw) { params.push(`%${kw.toLowerCase()}%`); where.push(`LOWER(p.name) LIKE $${params.length}`); }
  if (category) { params.push(parseInt(category)); where.push(`p.category_id = $${params.length}`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const order = sort === 'price_asc' ? 'p.price ASC' : sort === 'price_desc' ? 'p.price DESC' : 'p.id DESC';
  const [{ c }] = await q(`SELECT COUNT(*) AS c FROM products p ${w}`, params);
  const rows = await q(
    `SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id ${w} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params,
  );
  res.json({ items: withRating(rows, await ratingMap()), total: num(c), page, pages: Math.max(1, Math.ceil(num(c) / limit)) });
}));

api.get('/products/:id', auth(false), h(async (req, res) => {
  const id = parseInt(req.params.id);
  const [p] = await q('SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=$1', [id]);
  if (!p) return fail(res, 404, 'Không tìm thấy sản phẩm');
  // lưu lịch sử xem để phục vụ gợi ý
  await q('INSERT INTO product_views (user_id, product_id) VALUES ($1,$2)', [uid(req) ?? null, id]);
  const reviews = await q('SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=$1 ORDER BY r.id DESC', [id]);
  const [x] = withRating([p], await ratingMap());
  res.json({ ...x, reviewList: reviews });
}));

const productSchema = z.object({
  name: z.string().trim().min(1, 'Tên không được trống').max(200),
  description: z.string().max(5000).default(''),
  price: z.coerce.number().int().min(0, 'Giá không hợp lệ'),
  stock: z.coerce.number().int().min(0, 'Tồn kho không hợp lệ'),
  image_url: z.string().max(1000).default(''),
  category_id: z.coerce.number().int(),
});

api.post('/products', auth(), adminOnly, h(async (req, res) => {
  const d = productSchema.parse(req.body);
  const [p] = await q('INSERT INTO products (name,description,price,stock,image_url,category_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [
    d.name, d.description, d.price, d.stock, d.image_url, d.category_id,
  ]);
  res.status(201).json(p);
}));

api.put('/products/:id', auth(), adminOnly, h(async (req, res) => {
  const d = productSchema.parse(req.body);
  const [p] = await q('UPDATE products SET name=$1,description=$2,price=$3,stock=$4,image_url=$5,category_id=$6 WHERE id=$7 RETURNING *', [
    d.name, d.description, d.price, d.stock, d.image_url, d.category_id, parseInt(req.params.id),
  ]);
  if (!p) return fail(res, 404, 'Không tìm thấy sản phẩm');
  res.json(p);
}));

api.delete('/products/:id', auth(), adminOnly, h(async (req, res) => {
  const id = parseInt(req.params.id);
  const used = await q('SELECT id FROM order_items WHERE product_id=$1 LIMIT 1', [id]);
  if (used.length) return fail(res, 409, 'Sản phẩm đã có trong đơn hàng, không thể xoá (hãy đặt tồn kho = 0)');
  await q('DELETE FROM cart_items WHERE product_id=$1', [id]);
  await q('DELETE FROM reviews WHERE product_id=$1', [id]);
  await q('DELETE FROM product_views WHERE product_id=$1', [id]);
  await q('DELETE FROM products WHERE id=$1', [id]);
  res.json({ ok: true });
}));

// ================= REVIEWS =================
api.post('/products/:id/reviews', auth(), h(async (req, res) => {
  const d = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(1000).default('') }).parse(req.body);
  const pid = parseInt(req.params.id);
  if (!(await q('SELECT id FROM products WHERE id=$1', [pid])).length) return fail(res, 404, 'Không tìm thấy sản phẩm');
  const old = await q('SELECT id FROM reviews WHERE user_id=$1 AND product_id=$2', [uid(req), pid]);
  if (old.length) await q('UPDATE reviews SET rating=$1, comment=$2 WHERE id=$3', [d.rating, d.comment, old[0].id]);
  else await q('INSERT INTO reviews (user_id,product_id,rating,comment) VALUES ($1,$2,$3,$4)', [uid(req), pid, d.rating, d.comment]);
  res.status(201).json({ ok: true });
}));

// ================= RECOMMENDATIONS =================
// Điểm = 3*(mức quan tâm danh mục theo lịch sử xem) + độ phổ biến (mua + xem) + điểm đánh giá
// + 4 điểm nếu cùng danh mục với sản phẩm đang xem
api.get('/recommendations', auth(false), h(async (req, res) => {
  const productId = parseInt(req.query.productId as string) || null;
  const products = await q('SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id WHERE p.stock > 0');
  const sold = new Map((await q('SELECT product_id, SUM(quantity) AS s FROM order_items GROUP BY product_id')).map((r) => [r.product_id, num(r.s)]));
  const viewed = new Map((await q('SELECT product_id, COUNT(*) AS s FROM product_views GROUP BY product_id')).map((r) => [r.product_id, num(r.s)]));
  const pop = (id: number) => (sold.get(id) ?? 0) * 3 + (viewed.get(id) ?? 0);
  const maxPop = Math.max(1, ...products.map((p) => pop(p.id)));

  const catCount = new Map<number, number>();
  const seen = new Set<number>();
  if (uid(req)) {
    const hist = await q('SELECT v.product_id, p.category_id FROM product_views v JOIN products p ON p.id=v.product_id WHERE v.user_id=$1', [uid(req)]);
    hist.forEach((r) => { catCount.set(r.category_id, (catCount.get(r.category_id) ?? 0) + 1); seen.add(r.product_id); });
  }
  const maxCat = Math.max(1, ...catCount.values(), 1);

  let current: any = null;
  if (productId) current = products.find((p) => p.id === productId) ?? null;
  const rm = await ratingMap();

  const scored = products
    .filter((p) => p.id !== productId)
    .map((p) => {
      let s = 3 * ((catCount.get(p.category_id) ?? 0) / maxCat) + pop(p.id) / maxPop + (rm.get(p.id)?.rating ?? 0) / 5;
      if (current && p.category_id === current.category_id) s += 4;
      if (!productId && seen.has(p.id)) s -= 0.5; // trang chủ: ưu tiên sản phẩm mới mẻ hơn
      return { p, s };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.p);
  res.json(withRating(scored, rm));
}));

// ================= CART =================
const cartQuery = `SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price, p.stock, p.image_url
  FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=$1 ORDER BY ci.id`;

api.get('/cart', auth(), h(async (req, res) => res.json(await q(cartQuery, [uid(req)]))));

api.post('/cart', auth(), h(async (req, res) => {
  const d = z.object({ productId: z.coerce.number().int(), quantity: z.coerce.number().int().min(1).max(99).default(1) }).parse(req.body);
  const [p] = await q('SELECT stock FROM products WHERE id=$1', [d.productId]);
  if (!p) return fail(res, 404, 'Không tìm thấy sản phẩm');
  const [ex] = await q('SELECT id, quantity FROM cart_items WHERE user_id=$1 AND product_id=$2', [uid(req), d.productId]);
  const total = (ex?.quantity ?? 0) + d.quantity;
  if (total > p.stock) return fail(res, 400, `Chỉ còn ${p.stock} sản phẩm trong kho`);
  if (ex) await q('UPDATE cart_items SET quantity=$1 WHERE id=$2', [total, ex.id]);
  else await q('INSERT INTO cart_items (user_id,product_id,quantity) VALUES ($1,$2,$3)', [uid(req), d.productId, d.quantity]);
  res.json(await q(cartQuery, [uid(req)]));
}));

api.put('/cart/:productId', auth(), h(async (req, res) => {
  const d = z.object({ quantity: z.coerce.number().int().min(1).max(99) }).parse(req.body);
  const pid = parseInt(req.params.productId);
  const [p] = await q('SELECT stock FROM products WHERE id=$1', [pid]);
  if (!p || d.quantity > p.stock) return fail(res, 400, 'Vượt quá số lượng tồn kho');
  await q('UPDATE cart_items SET quantity=$1 WHERE user_id=$2 AND product_id=$3', [d.quantity, uid(req), pid]);
  res.json(await q(cartQuery, [uid(req)]));
}));

api.delete('/cart/:productId', auth(), h(async (req, res) => {
  await q('DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2', [uid(req), parseInt(req.params.productId)]);
  res.json(await q(cartQuery, [uid(req)]));
}));

// ================= ORDERS =================
async function ordersWithItems(orders: any[]) {
  for (const o of orders) o.items = await q('SELECT product_id, name, price, quantity FROM order_items WHERE order_id=$1', [o.id]);
  return orders;
}

api.post('/orders', auth(), h(async (req, res) => {
  const d = z.object({
    address: z.string().trim().min(5, 'Địa chỉ quá ngắn').max(300),
    phone: z.string().trim().regex(/^(0|\+84)\d{9}$/, 'Số điện thoại không hợp lệ'),
  }).parse(req.body);
  const items = await q(cartQuery, [uid(req)]);
  if (!items.length) return fail(res, 400, 'Giỏ hàng trống');
  for (const i of items) if (i.quantity > i.stock) return fail(res, 400, `"${i.name}" chỉ còn ${i.stock} sản phẩm`);
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const [o] = await q('INSERT INTO orders (user_id,total,status,address,phone) VALUES ($1,$2,$3,$4,$5) RETURNING *', [uid(req), total, 'pending', d.address, d.phone]);
  for (const i of items) {
    await q('INSERT INTO order_items (order_id,product_id,name,price,quantity) VALUES ($1,$2,$3,$4,$5)', [o.id, i.product_id, i.name, i.price, i.quantity]);
    await q('UPDATE products SET stock = stock - $1 WHERE id=$2', [i.quantity, i.product_id]);
  }
  await q('DELETE FROM cart_items WHERE user_id=$1', [uid(req)]);
  res.status(201).json(o);
}));

api.get('/orders', auth(), h(async (req, res) =>
  res.json(await ordersWithItems(await q('SELECT * FROM orders WHERE user_id=$1 ORDER BY id DESC', [uid(req)])))));

api.put('/orders/:id/cancel', auth(), h(async (req, res) => {
  const id = parseInt(req.params.id);
  const [o] = await q('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [id, uid(req)]);
  if (!o) return fail(res, 404, 'Không tìm thấy đơn hàng');
  if (o.status !== 'pending') return fail(res, 400, 'Chỉ huỷ được đơn đang chờ xử lý');
  await restock(id);
  await q('UPDATE orders SET status=$1 WHERE id=$2', ['cancelled', id]);
  res.json({ ok: true });
}));

async function restock(orderId: number) {
  const items = await q('SELECT product_id, quantity FROM order_items WHERE order_id=$1', [orderId]);
  for (const i of items) await q('UPDATE products SET stock = stock + $1 WHERE id=$2', [i.quantity, i.product_id]);
}

// ================= ADMIN =================
api.get('/admin/orders', auth(), adminOnly, h(async (_req, res) =>
  res.json(await ordersWithItems(await q('SELECT o.*, u.name AS user_name, u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC')))));

api.put('/admin/orders/:id/status', auth(), adminOnly, h(async (req, res) => {
  const d = z.object({ status: z.enum(['pending', 'processing', 'shipping', 'completed', 'cancelled']) }).parse(req.body);
  const id = parseInt(req.params.id);
  const [o] = await q('SELECT status FROM orders WHERE id=$1', [id]);
  if (!o) return fail(res, 404, 'Không tìm thấy đơn hàng');
  if (d.status === 'cancelled' && o.status !== 'cancelled') await restock(id);
  await q('UPDATE orders SET status=$1 WHERE id=$2', [d.status, id]);
  res.json({ ok: true });
}));

api.get('/admin/users', auth(), adminOnly, h(async (_req, res) =>
  res.json(await q('SELECT id,name,email,role,created_at FROM users ORDER BY id'))));

api.put('/admin/users/:id/role', auth(), adminOnly, h(async (req, res) => {
  const d = z.object({ role: z.enum(['user', 'admin']) }).parse(req.body);
  const id = parseInt(req.params.id);
  if (id === uid(req)) return fail(res, 400, 'Không thể đổi quyền của chính mình');
  await q('UPDATE users SET role=$1 WHERE id=$2', [d.role, id]);
  res.json({ ok: true });
}));

api.delete('/admin/users/:id', auth(), adminOnly, h(async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === uid(req)) return fail(res, 400, 'Không thể xoá chính mình');
  if ((await q('SELECT id FROM orders WHERE user_id=$1 LIMIT 1', [id])).length) return fail(res, 409, 'Người dùng đã có đơn hàng, không thể xoá');
  await q('DELETE FROM cart_items WHERE user_id=$1', [id]);
  await q('DELETE FROM reviews WHERE user_id=$1', [id]);
  await q('DELETE FROM product_views WHERE user_id=$1', [id]);
  await q('DELETE FROM users WHERE id=$1', [id]);
  res.json({ ok: true });
}));

// ================= CHATBOT =================
api.post('/chat', auth(false), h(async (req, res) => {
  const d = z.object({
    message: z.string().trim().min(1, 'Vui lòng nhập nội dung tin nhắn').max(1000, 'Tin nhắn quá dài'),
    history: z.array(z.object({ role: z.string().optional(), text: z.string().optional() })).optional(),
  }).parse(req.body);
  res.json(await chatReply(d.message, d.history, uid(req)));
}));
