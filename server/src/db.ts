import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { newDb } from 'pg-mem';

let pool: any;

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}

export async function initDb() {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    console.log('Dùng PostgreSQL từ DATABASE_URL');
  } else {
    const mem = newDb();
    const { Pool: MemPool } = mem.adapters.createPg();
    pool = new MemPool();
    console.log('Không có DATABASE_URL -> dùng DB trong bộ nhớ (demo, dữ liệu mất khi tắt server)');
  }

  const schema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
  for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }

  const users = await q('SELECT id FROM users LIMIT 1');
  if (users.length === 0) await seed();
}

async function seed() {
  await q('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)', [
    'Quản trị viên', 'admin@shop.com', bcrypt.hashSync('admin123', 10), 'admin',
  ]);
  await q('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)', [
    'Người dùng demo', 'user@shop.com', bcrypt.hashSync('user123', 10), 'user',
  ]);

  const data: Record<string, [string, number][]> = {
    'Điện thoại': [['iPhone 15', 22000000], ['Samsung Galaxy S24', 19000000], ['Xiaomi 14', 14000000], ['OPPO Reno 11', 9500000]],
    'Laptop': [['MacBook Air M2', 26000000], ['Dell XPS 13', 28000000], ['Asus Vivobook 15', 14000000], ['Lenovo ThinkPad E14', 17000000]],
    'Phụ kiện': [['Tai nghe Bluetooth', 800000], ['Sạc nhanh 65W', 450000], ['Chuột không dây', 350000], ['Bàn phím cơ', 1200000]],
    'Thời trang': [['Áo thun nam', 250000], ['Quần jean nữ', 450000], ['Giày thể thao', 900000], ['Balo laptop', 520000]],
    'Gia dụng': [['Nồi chiên không dầu', 1900000], ['Máy hút bụi mini', 1500000], ['Ấm siêu tốc', 300000], ['Quạt điều hòa', 2200000]],
  };
  let i = 1;
  for (const [cat, items] of Object.entries(data)) {
    const [c] = await q('INSERT INTO categories (name) VALUES ($1) RETURNING id', [cat]);
    for (const [name, price] of items) {
      await q('INSERT INTO products (name,description,price,stock,image_url,category_id) VALUES ($1,$2,$3,$4,$5,$6)', [
        name, `${name} - sản phẩm chính hãng, bảo hành 12 tháng.`, price, 20,
        `https://picsum.photos/seed/shop${i++}/400/300`, c.id,
      ]);
    }
  }
}
