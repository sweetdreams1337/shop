global using Row = System.Collections.Generic.Dictionary<string, object?>;
using Npgsql;

namespace Shop.Api;

public class ApiException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public class Db
{
    private readonly NpgsqlDataSource _ds;

    public Db(string raw) => _ds = NpgsqlDataSource.Create(BuildConn(raw));

    // Chấp nhận cả dạng URL (postgresql://user:pass@host:5432/db) lẫn chuỗi key=value
    public static string BuildConn(string raw)
    {
        raw = raw.Trim();
        if (!raw.StartsWith("postgres://") && !raw.StartsWith("postgresql://")) return raw;
        var u = new Uri(raw);
        var info = u.UserInfo.Split(':', 2);
        var local = u.Host is "localhost" or "127.0.0.1";
        return new NpgsqlConnectionStringBuilder
        {
            Host = u.Host,
            Port = u.Port > 0 ? u.Port : 5432,
            Database = u.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(info[0]),
            Password = info.Length > 1 ? Uri.UnescapeDataString(info[1]) : "",
            SslMode = local ? SslMode.Prefer : SslMode.Require,
        }.ConnectionString;
    }

    // Chạy câu SQL với tham số $1, $2... và trả về danh sách dòng
    public async Task<List<Row>> Q(string sql, params object?[] p)
    {
        await using var cmd = _ds.CreateCommand(sql);
        foreach (var v in p) cmd.Parameters.Add(new NpgsqlParameter { Value = v ?? DBNull.Value });
        await using var r = await cmd.ExecuteReaderAsync();
        var list = new List<Row>();
        while (await r.ReadAsync())
        {
            var row = new Row();
            for (var i = 0; i < r.FieldCount; i++)
            {
                var v = r.IsDBNull(i) ? null : r.GetValue(i);
                if (v is DateTime dt) v = DateTime.SpecifyKind(dt, DateTimeKind.Utc);
                row[r.GetName(i)] = v;
            }
            list.Add(row);
        }
        return list;
    }

    public async Task Init()
    {
        var schema = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "schema.sql"));
        foreach (var stmt in schema.Split(';').Select(s => s.Trim()).Where(s => s.Length > 0))
            await Q(stmt);
        if ((await Q("SELECT id FROM users LIMIT 1")).Count == 0) await Seed();
    }

    private async Task Seed()
    {
        await Q("INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)",
            "Quản trị viên", "admin@shop.com", BCrypt.Net.BCrypt.HashPassword("admin123"), "admin");
        await Q("INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)",
            "Người dùng demo", "user@shop.com", BCrypt.Net.BCrypt.HashPassword("user123"), "user");

        var data = new (string Cat, (string Name, int Price)[] Items)[]
        {
            ("Điện thoại", [("iPhone 15", 22000000), ("Samsung Galaxy S24", 19000000), ("Xiaomi 14", 14000000), ("OPPO Reno 11", 9500000)]),
            ("Laptop", [("MacBook Air M2", 26000000), ("Dell XPS 13", 28000000), ("Asus Vivobook 15", 14000000), ("Lenovo ThinkPad E14", 17000000)]),
            ("Phụ kiện", [("Tai nghe Bluetooth", 800000), ("Sạc nhanh 65W", 450000), ("Chuột không dây", 350000), ("Bàn phím cơ", 1200000)]),
            ("Thời trang", [("Áo thun nam", 250000), ("Quần jean nữ", 450000), ("Giày thể thao", 900000), ("Balo laptop", 520000)]),
            ("Gia dụng", [("Nồi chiên không dầu", 1900000), ("Máy hút bụi mini", 1500000), ("Ấm siêu tốc", 300000), ("Quạt điều hòa", 2200000)]),
        };
        var i = 1;
        foreach (var (cat, items) in data)
        {
            var c = (await Q("INSERT INTO categories (name) VALUES ($1) RETURNING id", cat))[0];
            foreach (var (name, price) in items)
                await Q("INSERT INTO products (name,description,price,stock,image_url,category_id) VALUES ($1,$2,$3,$4,$5,$6)",
                    name, $"{name} - sản phẩm chính hãng, bảo hành 12 tháng.", price, 20,
                    $"https://picsum.photos/seed/shop{i++}/400/300", c["id"]);
        }
    }
}
