# Chạy bằng Visual Studio (ASP.NET Core + Supabase)

Backend C# nằm ở `Shop.Api/` (thay cho `server/` bằng Node.js). API giữ nguyên đường dẫn và định dạng JSON nên frontend React (`client/`) dùng lại không cần sửa.

## 1. Cấu hình chuỗi kết nối Supabase
Dùng chuỗi **Session pooler** (xem hướng dẫn trước), dạng:
`postgresql://postgres.<project-ref>:<MATKHAU>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`

Trong Visual Studio: chuột phải project **Shop.Api → Manage User Secrets**, dán:
```json
{
  "DATABASE_URL": "postgresql://postgres.xxxx:MATKHAU@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
  "JWT_SECRET": "mot-chuoi-bi-mat-dai-hon-32-ky-tu"
}
```
User Secrets nằm ngoài thư mục dự án nên không bị đẩy lên GitHub. Nếu Supabase đã có bảng và dữ liệu từ bản Node thì dùng lại luôn.

## 2. Build giao diện (một lần)
```cmd
cd client
npm install
npm run build
```

## 3. Chạy
Mở `Shop.sln`, chọn **Shop.Api** làm Startup Project, nhấn **F5**. Trình duyệt mở `http://localhost:3001` (đủ cả web lẫn API, vì backend phục vụ `client/dist`).

Tài khoản demo: `admin@shop.com / admin123`, `user@shop.com / user123`.

## Phát triển giao diện (tuỳ chọn)
Chạy Shop.Api bằng F5, rồi trong `client` chạy `npm run dev` và mở `http://localhost:5173` (có hot reload, tự proxy `/api` sang cổng 3001).

## Ghi chú
- Project nhắm `net8.0` (mở được bằng Visual Studio 2022) và có `RollForward=Major` nên cũng chạy được trên runtime mới hơn.
- Bảng tự tạo từ `Shop.Api/schema.sql` ở lần chạy đầu.
