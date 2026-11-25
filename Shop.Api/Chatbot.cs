using System.Globalization;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Shop.Api;

public record ChatMsgDto(string? Role, string? Text);
public record ChatReqDto(string? Message, List<ChatMsgDto>? History);

public static class Chatbot
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    private static readonly Dictionary<string, string> OrderStatusVi = new()
    {
        ["pending"] = "Chờ xử lý",
        ["processing"] = "Đang xử lý",
        ["shipping"] = "Đang giao",
        ["completed"] = "Hoàn thành",
        ["cancelled"] = "Đã huỷ",
    };

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "toi", "minh", "em", "anh", "chi", "ban", "shop", "oi", "cho", "hoi", "muon", "can", "tim",
        "mua", "xem", "co", "khong", "ko", "k", "kh", "gi", "nao", "bao", "nhieu", "tien", "gia",
        "san", "pham", "sp", "cai", "chiec", "tu", "van", "goi", "y", "giup", "voi", "nhe", "nha",
        "duoc", "dc", "la", "cua", "va", "hay", "hoac", "trong", "ngoai", "duoi", "tren", "den",
        "tu", "re", "nhat", "dat", "cao", "thap", "con", "hang", "het", "trieu", "tr", "k", "nghin",
        "ngan", "dong", "vnd", "d", "the", "sao", "nhu", "nay", "kia", "do", "mot", "vai", "cac", "nhung"
    };

    private static string Norm(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        var formD = s.Trim().ToLowerInvariant().Replace('đ', 'd').Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(formD.Length);
        foreach (var ch in formD)
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) sb.Append(ch);
        return Regex.Replace(sb.ToString().Normalize(NormalizationForm.FormC), @"\s+", " ").Trim();
    }

    private static int I(object? o) => Convert.ToInt32(o);
    private static string Vnd(int n) => n.ToString("N0", new CultureInfo("vi-VN")) + " ₫";

    private static bool HasAny(string text, params string[] keys) => keys.Any(text.Contains);

    private static int? ParseAmount(string numStr, string unit)
    {
        if (!double.TryParse(numStr.Replace(',', '.'), NumberStyles.Any, CultureInfo.InvariantCulture, out var val)) return null;
        return unit switch
        {
            "trieu" or "tr" or "cu" => (int)Math.Round(val * 1_000_000),
            "k" or "nghin" or "ngan" => (int)Math.Round(val * 1_000),
            _ => val < 1000 ? (int)Math.Round(val * 1_000_000) : (int)Math.Round(val),
        };
    }

    private static (int? Min, int? Max) ExtractPriceRange(string norm)
    {
        var between = Regex.Match(norm, @"tu\s+(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan|d|vnd)?\s*(?:den|toi|-)\s*(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan|d|vnd)?");
        if (between.Success)
        {
            var u2 = between.Groups[4].Value;
            var u1 = string.IsNullOrEmpty(between.Groups[2].Value) ? u2 : between.Groups[2].Value;
            return (ParseAmount(between.Groups[1].Value, u1), ParseAmount(between.Groups[3].Value, u2));
        }
        var under = Regex.Match(norm, @"(?:duoi|<=|nho hon|it hon|toi da|tam|khoang)\s+(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan|d|vnd)");
        if (under.Success) return (null, ParseAmount(under.Groups[1].Value, under.Groups[2].Value));

        var over = Regex.Match(norm, @"(?:tren|>=|lon hon|hon|tu)\s+(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan|d|vnd)");
        if (over.Success) return (ParseAmount(over.Groups[1].Value, over.Groups[2].Value), null);

        return (null, null);
    }

    private static List<object> ToCards(IEnumerable<Row> rows) => rows.Take(4).Select(p => (object)new
    {
        id = I(p["id"]),
        name = p["name"],
        price = I(p["price"]),
        stock = I(p["stock"]),
        image_url = p["image_url"],
        category_name = p["category_name"],
    }).ToList();

    public static async Task<object> Reply(ChatReqDto req, int? userId, Db db, IConfiguration cfg)
    {
        var rawMsg = (req.Message ?? "").Trim();
        if (rawMsg.Length == 0) throw new ApiException(400, "Vui lòng nhập nội dung tin nhắn");
        if (rawMsg.Length > 1000) throw new ApiException(400, "Tin nhắn quá dài (tối đa 1000 ký tự)");

        var products = await db.Q("SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id ORDER BY p.id");
        var categories = await db.Q("SELECT * FROM categories ORDER BY id");
        var orders = userId is int u
            ? await db.Q("SELECT id, total, status, created_at FROM orders WHERE user_id=$1 ORDER BY id DESC LIMIT 5", u)
            : new List<Row>();

        // Tìm sản phẩm liên quan để gắn thẻ bấm vào được
        var norm = Norm(rawMsg);
        var matchedProducts = FindRelevantProducts(norm, products, categories);

        // Nếu có cấu hình GEMINI_API_KEY thì ưu tiên gọi Gemini AI, lỗi thì tự lùi về trợ lý tích hợp
        var apiKey = cfg["GEMINI_API_KEY"];
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            var aiText = await TryGemini(apiKey, rawMsg, req.History, products, categories, orders);
            if (!string.IsNullOrWhiteSpace(aiText))
            {
                return new
                {
                    reply = aiText,
                    products = ToCards(matchedProducts),
                    suggestions = new[] { "Gợi ý sản phẩm", "Tra cứu đơn hàng", "Chính sách giao hàng" },
                };
            }
        }

        // Trợ lý thông minh tích hợp (chạy ngay không cần API key)
        return RuleReply(norm, userId, products, categories, orders, matchedProducts);
    }

    private static List<Row> FindRelevantProducts(string norm, List<Row> products, List<Row> categories)
    {
        var (minPrice, maxPrice) = ExtractPriceRange(norm);
        var matchedCatIds = categories
            .Where(c => norm.Contains(Norm((string?)c["name"])))
            .Select(c => I(c["id"]))
            .ToHashSet();

        var tokens = Regex.Split(norm, @"[^a-z0-9]+")
            .Where(t => t.Length >= 2 && !StopWords.Contains(t))
            .Distinct()
            .ToList();

        IEnumerable<Row> pool = products;
        if (matchedCatIds.Count > 0) pool = pool.Where(p => matchedCatIds.Contains(I(p["category_id"])));
        if (minPrice.HasValue) pool = pool.Where(p => I(p["price"]) >= minPrice.Value);
        if (maxPrice.HasValue) pool = pool.Where(p => I(p["price"]) <= maxPrice.Value);

        if (HasAny(norm, "re nhat", "gia re", "thap nhat"))
            return pool.OrderBy(p => I(p["price"])).Take(4).ToList();
        if (HasAny(norm, "dat nhat", "cao cap", "cao nhat"))
            return pool.OrderByDescending(p => I(p["price"])).Take(4).ToList();

        if (tokens.Count > 0)
        {
            var scored = pool.Select(p =>
            {
                var pName = Norm((string?)p["name"]);
                var pCat = Norm((string?)p["category_name"]);
                var pDesc = Norm((string?)p["description"]);
                var score = 0;
                foreach (var t in tokens)
                {
                    if (pName.Contains(t)) score += 3;
                    else if (pCat.Contains(t)) score += 2;
                    else if (pDesc.Contains(t)) score += 1;
                }
                return (p, score);
            })
            .Where(x => x.score > 0)
            .OrderByDescending(x => x.score)
            .ThenBy(x => I(x.p["price"]))
            .ToList();

            if (scored.Count > 0)
            {
                var best = scored[0].score;
                return scored.Where(x => best < 6 || x.score >= best).Take(4).Select(x => x.p).ToList();
            }
        }

        if (matchedCatIds.Count > 0 || minPrice.HasValue || maxPrice.HasValue)
            return pool.OrderBy(p => I(p["price"])).Take(4).ToList();

        return new List<Row>();
    }

    private static object RuleReply(string norm, int? userId, List<Row> products, List<Row> categories, List<Row> orders, List<Row> matched)
    {
        // 1. Chào hỏi / cảm ơn
        if (Regex.IsMatch(norm, @"^(xin chao|chao|hello|hi|hey|alo|chao shop)\b"))
        {
            return new
            {
                reply = "Xin chào! Tôi là trợ lý ảo của Shop. Tôi có thể giúp bạn:\n• Tìm sản phẩm theo tên, danh mục hoặc tầm giá (VD: \"laptop dưới 20 triệu\", \"iPhone 15\")\n• Gợi ý sản phẩm nổi bật\n• Tra cứu trạng thái đơn hàng\n• Giải đáp giao hàng, thanh toán, bảo hành, đổi trả",
                products = Array.Empty<object>(),
                suggestions = new[] { "Gợi ý sản phẩm", "Danh mục sản phẩm", "Sản phẩm dưới 1 triệu", "Tra cứu đơn hàng" },
            };
        }
        if (HasAny(norm, "cam on", "thank", "tks", "ok shop"))
        {
            return new
            {
                reply = "Rất vui được hỗ trợ bạn! Nếu cần tìm thêm sản phẩm hoặc kiểm tra đơn hàng, cứ nhắn cho mình nhé.",
                products = Array.Empty<object>(),
                suggestions = new[] { "Gợi ý sản phẩm", "Chính sách bảo hành" },
            };
        }

        // 2. Tra cứu đơn hàng / huỷ đơn
        if (HasAny(norm, "don hang", "kiem tra don", "tra cuu don", "trang thai don", "huy don", "theo doi don"))
        {
            if (HasAny(norm, "huy don"))
            {
                return new
                {
                    reply = "Bạn có thể huỷ đơn hàng khi đơn đang ở trạng thái \"Chờ xử lý\": vào mục Đơn hàng trên thanh menu → bấm nút \"Huỷ đơn\". Số lượng sản phẩm sẽ được tự động hoàn lại kho.",
                    products = Array.Empty<object>(),
                    suggestions = new[] { "Tra cứu đơn hàng", "Chính sách giao hàng" },
                };
            }
            if (userId is null)
            {
                return new
                {
                    reply = "Để tra cứu đơn hàng của bạn, vui lòng đăng nhập tài khoản trước nhé (bấm \"Đăng nhập\" ở góc trên bên phải).",
                    products = Array.Empty<object>(),
                    suggestions = new[] { "Gợi ý sản phẩm", "Chính sách giao hàng" },
                };
            }
            if (orders.Count == 0)
            {
                return new
                {
                    reply = "Bạn chưa có đơn hàng nào. Hãy chọn sản phẩm yêu thích và thêm vào giỏ hàng để đặt mua nhé!",
                    products = Array.Empty<object>(),
                    suggestions = new[] { "Gợi ý sản phẩm", "Danh mục sản phẩm" },
                };
            }
            var lines = orders.Select(o =>
            {
                var st = OrderStatusVi.GetValueOrDefault((string?)o["status"] ?? "", (string?)o["status"] ?? "");
                return $"• Đơn #{o["id"]} — {st} — Tổng: {Vnd(I(o["total"]))}";
            });
            return new
            {
                reply = "Đây là các đơn hàng gần nhất của bạn:\n" + string.Join("\n", lines) + "\nBạn có thể vào mục \"Đơn hàng\" để xem chi tiết.",
                products = Array.Empty<object>(),
                suggestions = new[] { "Cách huỷ đơn", "Chính sách giao hàng" },
            };
        }

        // 3. Các câu hỏi thường gặp (FAQ)
        if (HasAny(norm, "giao hang", "van chuyen", "ship", "bao lau nhan duoc", "phi ship"))
        {
            return new
            {
                reply = "Chính sách giao hàng:\n• Giao hàng toàn quốc từ 2–4 ngày làm việc (nội thành 1–2 ngày).\n• Miễn phí vận chuyển cho đơn từ 500.000 ₫ (dưới 500.000 ₫ phí ship 30.000 ₫).\n• Được kiểm tra hàng trước khi thanh toán.",
                products = Array.Empty<object>(),
                suggestions = new[] { "Phương thức thanh toán", "Chính sách đổi trả", "Gợi ý sản phẩm" },
            };
        }
        if (HasAny(norm, "thanh toan", "cod", "chuyen khoan", "tra gop", "cach mua", "dat hang"))
        {
            return new
            {
                reply = "Hướng dẫn đặt hàng & thanh toán:\n• Chọn sản phẩm → bấm \"Thêm vào giỏ\" → vào Giỏ hàng → nhập địa chỉ & số điện thoại → bấm \"Đặt hàng\".\n• Hiện Shop hỗ trợ thanh toán khi nhận hàng (COD) an toàn và tiện lợi.",
                products = Array.Empty<object>(),
                suggestions = new[] { "Chính sách giao hàng", "Chính sách bảo hành" },
            };
        }
        if (HasAny(norm, "bao hanh", "doi tra", "hoan tien", "loi san pham"))
        {
            return new
            {
                reply = "Chính sách bảo hành & đổi trả:\n• Tất cả sản phẩm chính hãng được bảo hành 12 tháng.\n• Hỗ trợ đổi trả miễn phí trong 7 ngày nếu sản phẩm có lỗi từ nhà sản xuất hoặc giao sai mẫu.",
                products = Array.Empty<object>(),
                suggestions = new[] { "Liên hệ hỗ trợ", "Chính sách giao hàng" },
            };
        }
        if (HasAny(norm, "lien he", "hotline", "so dien thoai", "dia chi", "gio lam viec", "nhan vien"))
        {
            return new
            {
                reply = "Thông tin liên hệ hỗ trợ:\n• Hotline: 1900 1234 (8:00 – 21:00 tất cả các ngày trong tuần)\n• Email: support@shop.com\n• Địa chỉ: 12 Nguyễn Huệ, Quận 1, TP.HCM",
                products = Array.Empty<object>(),
                suggestions = new[] { "Gợi ý sản phẩm", "Tra cứu đơn hàng" },
            };
        }

        // 4. Hỏi danh mục
        if (HasAny(norm, "danh muc", "nhung loai nao", "ban gi", "co gi", "mat hang"))
        {
            var catNames = categories.Select(c => (string)c["name"]!).ToList();
            return new
            {
                reply = $"Hiện tại Shop đang kinh doanh {catNames.Count} danh mục: {string.Join(", ", catNames)}. Bạn quan tâm đến danh mục nào để mình tư vấn nhé?",
                products = Array.Empty<object>(),
                suggestions = catNames.Take(4).ToArray(),
            };
        }

        // 5. Gợi ý sản phẩm
        if (HasAny(norm, "goi y", "tu van", "ban chay", "pho bien", "nen mua", "noi bat") && matched.Count == 0)
        {
            var picks = products.Where(p => I(p["stock"]) > 0).Take(4).ToList();
            var list = string.Join("\n", picks.Select(p => $"• {p["name"]} — {Vnd(I(p["price"]))} (Còn {p["stock"]})"));
            return new
            {
                reply = "Một số sản phẩm nổi bật gợi ý cho bạn:\n" + list + "\nBấm vào sản phẩm bên dưới để xem chi tiết nhé!",
                products = ToCards(picks),
                suggestions = new[] { "Điện thoại", "Laptop", "Phụ kiện", "Sản phẩm dưới 1 triệu" },
            };
        }

        // 6. Kết quả tìm sản phẩm theo tên / danh mục / giá
        if (matched.Count > 0)
        {
            var lines = matched.Select(p =>
            {
                var stock = I(p["stock"]);
                var st = stock > 0 ? $"Còn {stock}" : "Hết hàng";
                return $"• {p["name"]} ({p["category_name"]}) — {Vnd(I(p["price"]))} [{st}]";
            });
            return new
            {
                reply = $"Mình tìm thấy {matched.Count} sản phẩm phù hợp:\n" + string.Join("\n", lines) + "\nBạn có thể bấm trực tiếp vào sản phẩm bên dưới để xem chi tiết và đặt mua.",
                products = ToCards(matched),
                suggestions = new[] { "Chính sách giao hàng", "Chính sách bảo hành", "Gợi ý sản phẩm" },
            };
        }

        // Có hỏi khoảng giá nhưng không có sản phẩm nào khớp
        var (minP, maxP) = ExtractPriceRange(norm);
        if (minP.HasValue || maxP.HasValue)
        {
            return new
            {
                reply = "Hiện chưa có sản phẩm nào trong khoảng giá bạn yêu cầu. Bạn có thể tham khảo các sản phẩm giá tốt khác bên dưới nhé!",
                products = ToCards(products.Where(p => I(p["stock"]) > 0).OrderBy(p => I(p["price"]))),
                suggestions = new[] { "Sản phẩm rẻ nhất", "Danh mục sản phẩm" },
            };
        }

        // 7. Mặc định
        return new
        {
            reply = "Xin lỗi, mình chưa hiểu rõ yêu cầu của bạn. Bạn thử hỏi cụ thể hơn như:\n• Tên sản phẩm: \"iPhone 15 giá bao nhiêu?\"\n• Theo danh mục & giá: \"Laptop dưới 20 triệu\", \"Phụ kiện\"\n• \"Tra cứu đơn hàng\", \"Chính sách giao hàng\", \"Bảo hành\"",
            products = Array.Empty<object>(),
            suggestions = new[] { "Gợi ý sản phẩm", "Danh mục sản phẩm", "Sản phẩm dưới 1 triệu", "Chính sách giao hàng" },
        };
    }

    private static async Task<string?> TryGemini(
        string apiKey, string message, List<ChatMsgDto>? history,
        List<Row> products, List<Row> categories, List<Row> orders)
    {
        try
        {
            var catalog = string.Join("\n", products.Select(p =>
                $"- {p["name"]} | Danh mục: {p["category_name"]} | Giá: {Vnd(I(p["price"]))} | Tồn kho: {p["stock"]}"));
            var orderInfo = orders.Count == 0
                ? "Khách chưa đăng nhập hoặc chưa có đơn hàng."
                : string.Join("\n", orders.Select(o =>
                    $"- Đơn #{o["id"]}: {OrderStatusVi.GetValueOrDefault((string?)o["status"] ?? "", "")}, tổng {Vnd(I(o["total"]))}"));

            var systemPrompt = $"""
                Bạn là nhân viên chăm sóc khách hàng thân thiện của website thương mại điện tử Shop.
                Trả lời ngắn gọn, tự nhiên bằng tiếng Việt, chỉ dựa vào dữ liệu thực tế dưới đây (không bịa sản phẩm hay giá).
                Chính sách: Thanh toán khi nhận hàng (COD), giao hàng 2-4 ngày (miễn phí đơn từ 500.000 ₫), bảo hành 12 tháng, đổi trả 7 ngày nếu lỗi NSX, hotline 1900 1234.

                Danh mục: {string.Join(", ", categories.Select(c => c["name"]))}
                Danh sách sản phẩm hiện có:
                {catalog}

                Đơn hàng gần đây của khách:
                {orderInfo}
                """;

            var contents = new List<object>();
            if (history is not null)
            {
                foreach (var m in history.TakeLast(6))
                {
                    if (string.IsNullOrWhiteSpace(m.Text)) continue;
                    contents.Add(new
                    {
                        role = m.Role == "user" ? "user" : "model",
                        parts = new[] { new { text = m.Text } },
                    });
                }
            }
            contents.Add(new { role = "user", parts = new[] { new { text = message } } });

            var payload = new
            {
                systemInstruction = new { parts = new[] { new { text = systemPrompt } } },
                contents,
            };

            var url = $"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={Uri.EscapeDataString(apiKey)}";
            using var res = await Http.PostAsJsonAsync(url, payload);
            if (!res.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            return doc.RootElement
                .GetProperty("candidates")[0]
                .GetProperty("content")
                .GetProperty("parts")[0]
                .GetProperty("text")
                .GetString();
        }
        catch
        {
            return null;
        }
    }
}
