# Website thương mại điện tử tích hợp gợi ý sản phẩm

**Công nghệ:** React + TypeScript (Vite) · Node.js + Express (TypeScript) · PostgreSQL/Supabase (REST API, JWT).

## Chức năng
- **Người dùng:** đăng ký/đăng nhập, tìm kiếm + lọc danh mục + sắp xếp + phân trang, xem chi tiết, giỏ hàng, đặt hàng (COD), xem/huỷ đơn, đánh giá sản phẩm (1–5 sao).
- **Quản trị viên:** CRUD sản phẩm, quản lý đơn hàng (đổi trạng thái), quản lý người dùng (đổi quyền, xoá).
- **Gợi ý sản phẩm** ([routes.ts](server/src/routes.ts), `/api/recommendations`): điểm = danh mục hay xem (lịch sử xem) + độ phổ biến (lượt mua, lượt xem) + điểm đánh giá, cộng thêm nếu cùng danh mục với sản phẩm đang xem.
- **Bảo mật:** phân quyền user/admin (JWT), kiểm tra đầu vào bằng zod, truy vấn tham số hoá (chống SQL injection), bcrypt băm mật khẩu, helmet.

## Chạy trên máy (cần cài Node.js 18+)
```bash
# Terminal 1 - API (cổng 3001)
cd server
npm install
npm run dev

# Terminal 2 - Giao diện (cổng 5173)
cd client
npm install
npm run dev
```
Mở http://localhost:5173. Tài khoản demo: `admin@shop.com / admin123`, `user@shop.com / user123`.

Không đặt `DATABASE_URL` thì server dùng DB trong bộ nhớ (dữ liệu mất khi tắt). Để dùng PostgreSQL/Supabase thật:
```bash
set DATABASE_URL=postgresql://user:pass@host:5432/db     # Supabase: Project Settings > Database > Connection string
set PGSSL=true
set JWT_SECRET=chuoi-bi-mat-dai
```
Bảng được tạo tự động từ [schema.sql](server/schema.sql) và có dữ liệu mẫu ở lần chạy đầu.

## Triển khai cloud (ví dụ Render, 1 service)
1. Đẩy code lên GitHub; tạo DB Supabase, lấy `DATABASE_URL`.
2. Render → New Web Service:
   - Build: `cd client && npm install && npm run build && cd ../server && npm install && npm run build`
   - Start: `cd server && npm start`
   - Env: `DATABASE_URL`, `PGSSL=true`, `JWT_SECRET`.
3. Server tự phục vụ giao diện từ `client/dist` nên chỉ cần 1 URL.
(Hoặc tách frontend lên Vercel và đặt `VITE_API_URL=https://<api>/api`.)

## Cấu trúc CSDL
users, categories, products, cart_items, orders, order_items, reviews, product_views — xem [schema.sql](server/schema.sql).
