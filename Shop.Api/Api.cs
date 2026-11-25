using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.RegularExpressions;
using System.Text.Json.Serialization;
using Microsoft.IdentityModel.Tokens;

namespace Shop.Api;

public record RegisterDto(string? Name, string? Email, string? Password);
public record LoginDto(string? Email, string? Password);
public record ProductDto(
    string? Name, string? Description, int? Price, int? Stock,
    [property: JsonPropertyName("image_url")] string? ImageUrl,
    [property: JsonPropertyName("category_id")] int? CategoryId);
public record ReviewDto(int? Rating, string? Comment);
public record CartAddDto(int? ProductId, int? Quantity);
public record QtyDto(int? Quantity);
public record OrderDto(string? Address, string? Phone);
public record StatusDto(string? Status);
public record RoleDto(string? Role);

public static class Api
{
    public static SymmetricSecurityKey Key = null!;

    // ---------- helpers ----------
    static int I(object? o) => Convert.ToInt32(o);
    static double D(object? o) => Convert.ToDouble(o);
    static int? Uid(HttpContext c) => int.TryParse(c.User.FindFirst("id")?.Value, out var v) ? v : null;
    static int MustUid(HttpContext c) => Uid(c) ?? throw new ApiException(401, "Bạn chưa đăng nhập");
    static ApiException Bad(string m) => new(400, m);

    static string Token(int id, string role)
    {
        var t = new JwtSecurityToken(
            claims: [new Claim("id", id.ToString()), new Claim("role", role)],
            expires: DateTime.UtcNow.AddDays(7),
            signingCredentials: new SigningCredentials(Key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(t);
    }

    static string Str(string? s, int min, int max, string msg)
    {
        s = s?.Trim() ?? "";
        if (s.Length < min || s.Length > max) throw Bad(msg);
        return s;
    }

    static string Email(string? s)
    {
        s = (s ?? "").Trim().ToLowerInvariant();
        if (!Regex.IsMatch(s, @"^[^@\s]+@[^@\s]+\.[^@\s]+$")) throw Bad("Email không hợp lệ");
        return s;
    }

    static async Task<Dictionary<int, (double Rating, int Reviews)>> RatingMap(Db db)
    {
        var m = new Dictionary<int, (double, int)>();
        foreach (var r in await db.Q("SELECT product_id, AVG(rating) AS avg, COUNT(*) AS cnt FROM reviews GROUP BY product_id"))
            m[I(r["product_id"])] = (Math.Round(D(r["avg"]) * 10) / 10, I(r["cnt"]));
        return m;
    }

    static List<Row> WithRating(IEnumerable<Row> list, Dictionary<int, (double Rating, int Reviews)> m)
    {
        var res = new List<Row>();
        foreach (var p in list)
        {
            var q = new Row(p);
            m.TryGetValue(I(p["id"]), out var x);
            q["rating"] = x.Rating;
            q["reviews"] = x.Reviews;
            res.Add(q);
        }
        return res;
    }

    static (string name, string desc, int price, int stock, string img, int cat) ValidProduct(ProductDto d)
    {
        var name = Str(d.Name, 1, 200, "Tên không được trống");
        if (d.Price is null or < 0) throw Bad("Giá không hợp lệ");
        if (d.Stock is null or < 0) throw Bad("Tồn kho không hợp lệ");
        if (d.CategoryId is null) throw Bad("Danh mục không hợp lệ");
        var desc = d.Description ?? "";
        var img = d.ImageUrl ?? "";
        if (desc.Length > 5000 || img.Length > 1000) throw Bad("Dữ liệu quá dài");
        return (name, desc, d.Price.Value, d.Stock.Value, img, d.CategoryId.Value);
    }

    const string CartQuery = @"SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price, p.stock, p.image_url
        FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=$1 ORDER BY ci.id";

    static async Task<List<Row>> OrdersWithItems(Db db, List<Row> orders)
    {
        foreach (var o in orders)
            o["items"] = await db.Q("SELECT product_id, name, price, quantity FROM order_items WHERE order_id=$1", o["id"]);
        return orders;
    }

    static async Task Restock(Db db, int orderId)
    {
        foreach (var i in await db.Q("SELECT product_id, quantity FROM order_items WHERE order_id=$1", orderId))
            await db.Q("UPDATE products SET stock = stock + $1 WHERE id=$2", i["quantity"], i["product_id"]);
    }

    // ---------- routes ----------
    public static void Map(WebApplication app)
    {
        var api = app.MapGroup("/api");
        var authed = api.MapGroup("").RequireAuthorization();
        var admin = api.MapGroup("").RequireAuthorization("admin");

        // ===== AUTH =====
        api.MapPost("/auth/register", async (RegisterDto d, Db db) =>
        {
            var name = Str(d.Name, 2, 100, "Tên tối thiểu 2 ký tự");
            var email = Email(d.Email);
            if (d.Password is null || d.Password.Length < 6 || d.Password.Length > 100) throw Bad("Mật khẩu tối thiểu 6 ký tự");
            if ((await db.Q("SELECT id FROM users WHERE email=$1", email)).Count > 0) throw new ApiException(409, "Email đã được đăng ký");
            var u = (await db.Q("INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role",
                name, email, BCrypt.Net.BCrypt.HashPassword(d.Password), "user"))[0];
            return Results.Json(new { token = Token(I(u["id"]), "user"), user = u }, statusCode: 201);
        });

        api.MapPost("/auth/login", async (LoginDto d, Db db) =>
        {
            var email = Email(d.Email);
            var u = (await db.Q("SELECT * FROM users WHERE email=$1", email)).FirstOrDefault();
            if (u is null || string.IsNullOrEmpty(d.Password) || !BCrypt.Net.BCrypt.Verify(d.Password, (string)u["password_hash"]!))
                throw new ApiException(401, "Sai email hoặc mật khẩu");
            return Results.Json(new
            {
                token = Token(I(u["id"]), (string)u["role"]!),
                user = new { id = u["id"], name = u["name"], email = u["email"], role = u["role"] },
            });
        });

        // ===== PRODUCTS =====
        api.MapGet("/categories", async (Db db) => Results.Json(await db.Q("SELECT * FROM categories ORDER BY id")));

        api.MapGet("/products", async (HttpContext ctx, Db db) =>
        {
            var qs = ctx.Request.Query;
            int.TryParse(qs["page"], out var pg);
            var page = Math.Max(1, pg);
            const int limit = 12;
            var where = new List<string>();
            var ps = new List<object?>();
            if (!string.IsNullOrEmpty(qs["q"])) { ps.Add($"%{qs["q"].ToString().ToLowerInvariant()}%"); where.Add($"LOWER(p.name) LIKE ${ps.Count}"); }
            if (int.TryParse(qs["category"], out var cat)) { ps.Add(cat); where.Add($"p.category_id = ${ps.Count}"); }
            var w = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";
            var order = qs["sort"] == "price_asc" ? "p.price ASC" : qs["sort"] == "price_desc" ? "p.price DESC" : "p.id DESC";
            var total = I((await db.Q($"SELECT COUNT(*) AS c FROM products p {w}", ps.ToArray()))[0]["c"]);
            var rows = await db.Q($"SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id {w} ORDER BY {order} LIMIT {limit} OFFSET {(page - 1) * limit}", ps.ToArray());
            return Results.Json(new
            {
                items = WithRating(rows, await RatingMap(db)),
                total,
                page,
                pages = Math.Max(1, (int)Math.Ceiling(total / (double)limit)),
            });
        });

        api.MapGet("/products/{id:int}", async (int id, HttpContext ctx, Db db) =>
        {
            var p = (await db.Q("SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=$1", id)).FirstOrDefault()
                ?? throw new ApiException(404, "Không tìm thấy sản phẩm");
            // lưu lịch sử xem để phục vụ gợi ý
            await db.Q("INSERT INTO product_views (user_id, product_id) VALUES ($1,$2)", Uid(ctx), id);
            var reviews = await db.Q("SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=$1 ORDER BY r.id DESC", id);
            var x = WithRating([p], await RatingMap(db))[0];
            x["reviewList"] = reviews;
            return Results.Json(x);
        });

        admin.MapPost("/products", async (ProductDto d, Db db) =>
        {
            var v = ValidProduct(d);
            var p = (await db.Q("INSERT INTO products (name,description,price,stock,image_url,category_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
                v.name, v.desc, v.price, v.stock, v.img, v.cat))[0];
            return Results.Json(p, statusCode: 201);
        });

        admin.MapPut("/products/{id:int}", async (int id, ProductDto d, Db db) =>
        {
            var v = ValidProduct(d);
            var p = (await db.Q("UPDATE products SET name=$1,description=$2,price=$3,stock=$4,image_url=$5,category_id=$6 WHERE id=$7 RETURNING *",
                v.name, v.desc, v.price, v.stock, v.img, v.cat, id)).FirstOrDefault()
                ?? throw new ApiException(404, "Không tìm thấy sản phẩm");
            return Results.Json(p);
        });

        admin.MapDelete("/products/{id:int}", async (int id, Db db) =>
        {
            if ((await db.Q("SELECT id FROM order_items WHERE product_id=$1 LIMIT 1", id)).Count > 0)
                throw new ApiException(409, "Sản phẩm đã có trong đơn hàng, không thể xoá (hãy đặt tồn kho = 0)");
            await db.Q("DELETE FROM cart_items WHERE product_id=$1", id);
            await db.Q("DELETE FROM reviews WHERE product_id=$1", id);
            await db.Q("DELETE FROM product_views WHERE product_id=$1", id);
            await db.Q("DELETE FROM products WHERE id=$1", id);
            return Results.Json(new { ok = true });
        });

        // ===== REVIEWS =====
        authed.MapPost("/products/{id:int}/reviews", async (int id, ReviewDto d, HttpContext ctx, Db db) =>
        {
            if (d.Rating is null or < 1 or > 5) throw Bad("Số sao phải từ 1 đến 5");
            var comment = (d.Comment ?? "").Trim();
            if (comment.Length > 1000) throw Bad("Nhận xét quá dài");
            if ((await db.Q("SELECT id FROM products WHERE id=$1", id)).Count == 0) throw new ApiException(404, "Không tìm thấy sản phẩm");
            var uid = MustUid(ctx);
            var old = await db.Q("SELECT id FROM reviews WHERE user_id=$1 AND product_id=$2", uid, id);
            if (old.Count > 0) await db.Q("UPDATE reviews SET rating=$1, comment=$2 WHERE id=$3", d.Rating.Value, comment, old[0]["id"]);
            else await db.Q("INSERT INTO reviews (user_id,product_id,rating,comment) VALUES ($1,$2,$3,$4)", uid, id, d.Rating.Value, comment);
            return Results.Json(new { ok = true }, statusCode: 201);
        });

        // ===== RECOMMENDATIONS =====
        // Điểm = 3*(mức quan tâm danh mục theo lịch sử xem) + độ phổ biến (mua + xem) + điểm đánh giá
        // + 4 điểm nếu cùng danh mục với sản phẩm đang xem
        api.MapGet("/recommendations", async (HttpContext ctx, Db db) =>
        {
            int? productId = int.TryParse(ctx.Request.Query["productId"], out var pid) ? pid : null;
            var products = await db.Q("SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id WHERE p.stock > 0");
            var sold = (await db.Q("SELECT product_id, SUM(quantity) AS s FROM order_items GROUP BY product_id")).ToDictionary(r => I(r["product_id"]), r => D(r["s"]));
            var viewed = (await db.Q("SELECT product_id, COUNT(*) AS s FROM product_views GROUP BY product_id")).ToDictionary(r => I(r["product_id"]), r => D(r["s"]));
            double Pop(int id) => sold.GetValueOrDefault(id) * 3 + viewed.GetValueOrDefault(id);
            var maxPop = Math.Max(1, products.Select(p => Pop(I(p["id"]))).DefaultIfEmpty(0).Max());

            var catCount = new Dictionary<int, int>();
            var seen = new HashSet<int>();
            if (Uid(ctx) is int u)
            {
                foreach (var r in await db.Q("SELECT v.product_id, p.category_id FROM product_views v JOIN products p ON p.id=v.product_id WHERE v.user_id=$1", u))
                {
                    var c = I(r["category_id"]);
                    catCount[c] = catCount.GetValueOrDefault(c) + 1;
                    seen.Add(I(r["product_id"]));
                }
            }
            var maxCat = Math.Max(1, catCount.Values.DefaultIfEmpty(1).Max());
            var current = productId is null ? null : products.FirstOrDefault(p => I(p["id"]) == productId);
            var rm = await RatingMap(db);

            var top = products
                .Where(p => I(p["id"]) != productId)
                .Select(p =>
                {
                    var id = I(p["id"]);
                    var cat = I(p["category_id"]);
                    var s = 3.0 * catCount.GetValueOrDefault(cat) / maxCat + Pop(id) / maxPop + (rm.TryGetValue(id, out var rr) ? rr.Rating : 0) / 5;
                    if (current is not null && cat == I(current["category_id"])) s += 4;
                    if (productId is null && seen.Contains(id)) s -= 0.5;
                    return (p, s);
                })
                .OrderByDescending(x => x.s)
                .Take(8)
                .Select(x => x.p);
            return Results.Json(WithRating(top, rm));
        });

        // ===== CART =====
        authed.MapGet("/cart", async (HttpContext ctx, Db db) => Results.Json(await db.Q(CartQuery, MustUid(ctx))));

        authed.MapPost("/cart", async (CartAddDto d, HttpContext ctx, Db db) =>
        {
            if (d.ProductId is null) throw Bad("Thiếu sản phẩm");
            var qty = d.Quantity ?? 1;
            if (qty < 1 || qty > 99) throw Bad("Số lượng không hợp lệ");
            var uid = MustUid(ctx);
            var p = (await db.Q("SELECT stock FROM products WHERE id=$1", d.ProductId.Value)).FirstOrDefault()
                ?? throw new ApiException(404, "Không tìm thấy sản phẩm");
            var ex = (await db.Q("SELECT id, quantity FROM cart_items WHERE user_id=$1 AND product_id=$2", uid, d.ProductId.Value)).FirstOrDefault();
            var total = (ex is null ? 0 : I(ex["quantity"])) + qty;
            if (total > I(p["stock"])) throw Bad($"Chỉ còn {p["stock"]} sản phẩm trong kho");
            if (ex is not null) await db.Q("UPDATE cart_items SET quantity=$1 WHERE id=$2", total, ex["id"]);
            else await db.Q("INSERT INTO cart_items (user_id,product_id,quantity) VALUES ($1,$2,$3)", uid, d.ProductId.Value, qty);
            return Results.Json(await db.Q(CartQuery, uid));
        });

        authed.MapPut("/cart/{productId:int}", async (int productId, QtyDto d, HttpContext ctx, Db db) =>
        {
            if (d.Quantity is null or < 1 or > 99) throw Bad("Số lượng không hợp lệ");
            var uid = MustUid(ctx);
            var p = (await db.Q("SELECT stock FROM products WHERE id=$1", productId)).FirstOrDefault();
            if (p is null || d.Quantity > I(p["stock"])) throw Bad("Vượt quá số lượng tồn kho");
            await db.Q("UPDATE cart_items SET quantity=$1 WHERE user_id=$2 AND product_id=$3", d.Quantity.Value, uid, productId);
            return Results.Json(await db.Q(CartQuery, uid));
        });

        authed.MapDelete("/cart/{productId:int}", async (int productId, HttpContext ctx, Db db) =>
        {
            var uid = MustUid(ctx);
            await db.Q("DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2", uid, productId);
            return Results.Json(await db.Q(CartQuery, uid));
        });

        // ===== ORDERS =====
        authed.MapPost("/orders", async (OrderDto d, HttpContext ctx, Db db) =>
        {
            var address = Str(d.Address, 5, 300, "Địa chỉ quá ngắn");
            var phone = (d.Phone ?? "").Trim();
            if (!Regex.IsMatch(phone, @"^(0|\+84)\d{9}$")) throw Bad("Số điện thoại không hợp lệ");
            var uid = MustUid(ctx);
            var items = await db.Q(CartQuery, uid);
            if (items.Count == 0) throw Bad("Giỏ hàng trống");
            foreach (var i in items)
                if (I(i["quantity"]) > I(i["stock"])) throw Bad($"\"{i["name"]}\" chỉ còn {i["stock"]} sản phẩm");
            var total = items.Sum(i => I(i["price"]) * I(i["quantity"]));
            var o = (await db.Q("INSERT INTO orders (user_id,total,status,address,phone) VALUES ($1,$2,$3,$4,$5) RETURNING *", uid, total, "pending", address, phone))[0];
            foreach (var i in items)
            {
                await db.Q("INSERT INTO order_items (order_id,product_id,name,price,quantity) VALUES ($1,$2,$3,$4,$5)", o["id"], i["product_id"], i["name"], i["price"], i["quantity"]);
                await db.Q("UPDATE products SET stock = stock - $1 WHERE id=$2", i["quantity"], i["product_id"]);
            }
            await db.Q("DELETE FROM cart_items WHERE user_id=$1", uid);
            return Results.Json(o, statusCode: 201);
        });

        authed.MapGet("/orders", async (HttpContext ctx, Db db) =>
            Results.Json(await OrdersWithItems(db, await db.Q("SELECT * FROM orders WHERE user_id=$1 ORDER BY id DESC", MustUid(ctx)))));

        authed.MapPut("/orders/{id:int}/cancel", async (int id, HttpContext ctx, Db db) =>
        {
            var o = (await db.Q("SELECT * FROM orders WHERE id=$1 AND user_id=$2", id, MustUid(ctx))).FirstOrDefault()
                ?? throw new ApiException(404, "Không tìm thấy đơn hàng");
            if ((string)o["status"]! != "pending") throw Bad("Chỉ huỷ được đơn đang chờ xử lý");
            await Restock(db, id);
            await db.Q("UPDATE orders SET status=$1 WHERE id=$2", "cancelled", id);
            return Results.Json(new { ok = true });
        });

        // ===== ADMIN =====
        admin.MapGet("/admin/orders", async (Db db) =>
            Results.Json(await OrdersWithItems(db, await db.Q("SELECT o.*, u.name AS user_name, u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC"))));

        admin.MapPut("/admin/orders/{id:int}/status", async (int id, StatusDto d, Db db) =>
        {
            string[] ok = ["pending", "processing", "shipping", "completed", "cancelled"];
            if (d.Status is null || !ok.Contains(d.Status)) throw Bad("Trạng thái không hợp lệ");
            var o = (await db.Q("SELECT status FROM orders WHERE id=$1", id)).FirstOrDefault()
                ?? throw new ApiException(404, "Không tìm thấy đơn hàng");
            if (d.Status == "cancelled" && (string)o["status"]! != "cancelled") await Restock(db, id);
            await db.Q("UPDATE orders SET status=$1 WHERE id=$2", d.Status, id);
            return Results.Json(new { ok = true });
        });

        admin.MapGet("/admin/users", async (Db db) =>
            Results.Json(await db.Q("SELECT id,name,email,role,created_at FROM users ORDER BY id")));

        admin.MapPut("/admin/users/{id:int}/role", async (int id, RoleDto d, HttpContext ctx, Db db) =>
        {
            if (d.Role is not ("user" or "admin")) throw Bad("Quyền không hợp lệ");
            if (id == Uid(ctx)) throw Bad("Không thể đổi quyền của chính mình");
            await db.Q("UPDATE users SET role=$1 WHERE id=$2", d.Role, id);
            return Results.Json(new { ok = true });
        });

        admin.MapDelete("/admin/users/{id:int}", async (int id, HttpContext ctx, Db db) =>
        {
            if (id == Uid(ctx)) throw Bad("Không thể xoá chính mình");
            if ((await db.Q("SELECT id FROM orders WHERE user_id=$1 LIMIT 1", id)).Count > 0) throw new ApiException(409, "Người dùng đã có đơn hàng, không thể xoá");
            await db.Q("DELETE FROM cart_items WHERE user_id=$1", id);
            await db.Q("DELETE FROM reviews WHERE user_id=$1", id);
            await db.Q("DELETE FROM product_views WHERE user_id=$1", id);
            await db.Q("DELETE FROM users WHERE id=$1", id);
            return Results.Json(new { ok = true });
        });

        // ===== CHATBOT =====
        api.MapPost("/chat", async (ChatReqDto d, HttpContext ctx, Db db, IConfiguration cfg) =>
            Results.Json(await Chatbot.Reply(d, Uid(ctx), db, cfg)));
    }
}
