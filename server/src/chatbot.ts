import { q } from './db';

const STATUS_VI: Record<string, string> = {
  pending: 'Chờ xử lý',
  processing: 'Đang xử lý',
  shipping: 'Đang giao',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

const STOP_WORDS = new Set([
  'toi', 'minh', 'em', 'anh', 'chi', 'ban', 'shop', 'oi', 'cho', 'hoi', 'muon', 'can', 'tim',
  'mua', 'xem', 'co', 'khong', 'ko', 'k', 'kh', 'gi', 'nao', 'bao', 'nhieu', 'tien', 'gia',
  'san', 'pham', 'sp', 'cai', 'chiec', 'tu', 'van', 'goi', 'y', 'giup', 'voi', 'nhe', 'nha',
  'duoc', 'dc', 'la', 'cua', 'va', 'hay', 'hoac', 'trong', 'ngoai', 'duoi', 'tren', 'den',
  're', 'nhat', 'dat', 'cao', 'thap', 'con', 'hang', 'het', 'trieu', 'tr', 'nghin', 'ngan',
  'dong', 'vnd', 'd', 'the', 'sao', 'nhu', 'nay', 'kia', 'do', 'mot', 'vai', 'cac', 'nhung',
]);

const norm = (s = '') =>
  s.trim().toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

const vnd = (n: number) => Number(n).toLocaleString('vi-VN') + ' ₫';
const hasAny = (text: string, keys: string[]) => keys.some((k) => text.includes(k));

function parseAmount(numStr: string, unit: string): number | null {
  const val = parseFloat(numStr.replace(',', '.'));
  if (Number.isNaN(val)) return null;
  if (unit === 'trieu' || unit === 'tr' || unit === 'cu') return Math.round(val * 1_000_000);
  if (unit === 'k' || unit === 'nghin' || unit === 'ngan') return Math.round(val * 1_000);
  return val < 1000 ? Math.round(val * 1_000_000) : Math.round(val);
}

function extractPriceRange(text: string): { min?: number; max?: number } {
  const between = text.match(/tu\s+(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan|d|vnd)?\s*(?:den|toi|-)\s*(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan|d|vnd)?/);
  if (between) {
    const u2 = between[4] || '';
    const u1 = between[2] || u2;
    return { min: parseAmount(between[1], u1) ?? undefined, max: parseAmount(between[3], u2) ?? undefined };
  }
  const under = text.match(/(?:duoi|<=|nho hon|it hon|toi da|tam|khoang)\s+(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan|d|vnd)/);
  if (under) return { max: parseAmount(under[1], under[2]) ?? undefined };
  const over = text.match(/(?:tren|>=|lon hon|hon|tu)\s+(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|k|nghin|ngan|d|vnd)/);
  if (over) return { min: parseAmount(over[1], over[2]) ?? undefined };
  return {};
}

const toCards = (rows: any[]) =>
  rows.slice(0, 4).map((p) => ({
    id: p.id, name: p.name, price: p.price, stock: p.stock, image_url: p.image_url, category_name: p.category_name,
  }));

function findRelevantProducts(text: string, products: any[], categories: any[]) {
  const { min, max } = extractPriceRange(text);
  const catIds = new Set(categories.filter((c) => text.includes(norm(c.name))).map((c) => c.id));
  const tokens = [...new Set(text.split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP_WORDS.has(t)))];

  let pool = products;
  if (catIds.size) pool = pool.filter((p) => catIds.has(p.category_id));
  if (min !== undefined) pool = pool.filter((p) => p.price >= min);
  if (max !== undefined) pool = pool.filter((p) => p.price <= max);

  if (hasAny(text, ['re nhat', 'gia re', 'thap nhat'])) return [...pool].sort((a, b) => a.price - b.price).slice(0, 4);
  if (hasAny(text, ['dat nhat', 'cao cap', 'cao nhat'])) return [...pool].sort((a, b) => b.price - a.price).slice(0, 4);

  if (tokens.length) {
    const scored = pool
      .map((p) => {
        const pName = norm(p.name), pCat = norm(p.category_name), pDesc = norm(p.description);
        let score = 0;
        for (const t of tokens) {
          if (pName.includes(t)) score += 3;
          else if (pCat.includes(t)) score += 2;
          else if (pDesc.includes(t)) score += 1;
        }
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.p.price - b.p.price);
    if (scored.length) {
      const best = scored[0].score;
      return scored.filter((x) => best < 6 || x.score >= best).slice(0, 4).map((x) => x.p);
    }
  }

  if (catIds.size || min !== undefined || max !== undefined) return [...pool].sort((a, b) => a.price - b.price).slice(0, 4);
  return [];
}

async function tryGemini(
  apiKey: string, message: string, history: { role?: string; text?: string }[] | undefined,
  products: any[], categories: any[], orders: any[],
): Promise<string | null> {
  try {
    const catalog = products.map((p) => `- ${p.name} | Danh mục: ${p.category_name} | Giá: ${vnd(p.price)} | Tồn kho: ${p.stock}`).join('\n');
    const orderInfo = orders.length
      ? orders.map((o) => `- Đơn #${o.id}: ${STATUS_VI[o.status] || o.status}, tổng ${vnd(o.total)}`).join('\n')
      : 'Khách chưa đăng nhập hoặc chưa có đơn hàng.';

    const systemPrompt = `Bạn là nhân viên chăm sóc khách hàng thân thiện của website thương mại điện tử Shop.
Trả lời ngắn gọn, tự nhiên bằng tiếng Việt, chỉ dựa vào dữ liệu thực tế dưới đây (không bịa sản phẩm hay giá).
Chính sách: Thanh toán khi nhận hàng (COD), giao hàng 2-4 ngày (miễn phí đơn từ 500.000 ₫), bảo hành 12 tháng, đổi trả 7 ngày nếu lỗi NSX, hotline 1900 1234.

Danh mục: ${categories.map((c) => c.name).join(', ')}
Danh sách sản phẩm hiện có:
${catalog}

Đơn hàng gần đây của khách:
${orderInfo}`;

    const contents: any[] = (history || [])
      .slice(-6)
      .filter((m) => m.text?.trim())
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
    contents.push({ role: 'user', parts: [{ text: message }] });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch {
    return null;
  }
}

export async function chatReply(message: string, history: { role?: string; text?: string }[] | undefined, userId?: number) {
  const products = await q('SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id ORDER BY p.id');
  const categories = await q('SELECT * FROM categories ORDER BY id');
  const orders = userId ? await q('SELECT id, total, status, created_at FROM orders WHERE user_id=$1 ORDER BY id DESC LIMIT 5', [userId]) : [];

  const text = norm(message);
  const matched = findRelevantProducts(text, products, categories);

  if (process.env.GEMINI_API_KEY) {
    const aiText = await tryGemini(process.env.GEMINI_API_KEY, message, history, products, categories, orders);
    if (aiText) {
      return { reply: aiText, products: toCards(matched), suggestions: ['Gợi ý sản phẩm', 'Tra cứu đơn hàng', 'Chính sách giao hàng'] };
    }
  }

  if (/^(xin chao|chao|hello|hi|hey|alo|chao shop)\b/.test(text)) {
    return {
      reply: 'Xin chào! Tôi là trợ lý ảo của Shop. Tôi có thể giúp bạn:\n• Tìm sản phẩm theo tên, danh mục hoặc tầm giá (VD: "laptop dưới 20 triệu", "iPhone 15")\n• Gợi ý sản phẩm nổi bật\n• Tra cứu trạng thái đơn hàng\n• Giải đáp giao hàng, thanh toán, bảo hành, đổi trả',
      products: [],
      suggestions: ['Gợi ý sản phẩm', 'Danh mục sản phẩm', 'Sản phẩm dưới 1 triệu', 'Tra cứu đơn hàng'],
    };
  }
  if (hasAny(text, ['cam on', 'thank', 'tks', 'ok shop'])) {
    return {
      reply: 'Rất vui được hỗ trợ bạn! Nếu cần tìm thêm sản phẩm hoặc kiểm tra đơn hàng, cứ nhắn cho mình nhé.',
      products: [],
      suggestions: ['Gợi ý sản phẩm', 'Chính sách bảo hành'],
    };
  }
  if (hasAny(text, ['don hang', 'kiem tra don', 'tra cuu don', 'trang thai don', 'huy don', 'theo doi don'])) {
    if (hasAny(text, ['huy don'])) {
      return {
        reply: 'Bạn có thể huỷ đơn hàng khi đơn đang ở trạng thái "Chờ xử lý": vào mục Đơn hàng trên thanh menu → bấm nút "Huỷ đơn". Số lượng sản phẩm sẽ được tự động hoàn lại kho.',
        products: [],
        suggestions: ['Tra cứu đơn hàng', 'Chính sách giao hàng'],
      };
    }
    if (!userId) {
      return {
        reply: 'Để tra cứu đơn hàng của bạn, vui lòng đăng nhập tài khoản trước nhé (bấm "Đăng nhập" ở góc trên bên phải).',
        products: [],
        suggestions: ['Gợi ý sản phẩm', 'Chính sách giao hàng'],
      };
    }
    if (!orders.length) {
      return {
        reply: 'Bạn chưa có đơn hàng nào. Hãy chọn sản phẩm yêu thích và thêm vào giỏ hàng để đặt mua nhé!',
        products: [],
        suggestions: ['Gợi ý sản phẩm', 'Danh mục sản phẩm'],
      };
    }
    const lines = orders.map((o) => `• Đơn #${o.id} — ${STATUS_VI[o.status] || o.status} — Tổng: ${vnd(o.total)}`);
    return {
      reply: `Đây là các đơn hàng gần nhất của bạn:\n${lines.join('\n')}\nBạn có thể vào mục "Đơn hàng" để xem chi tiết.`,
      products: [],
      suggestions: ['Cách huỷ đơn', 'Chính sách giao hàng'],
    };
  }
  if (hasAny(text, ['giao hang', 'van chuyen', 'ship', 'bao lau nhan duoc', 'phi ship'])) {
    return {
      reply: 'Chính sách giao hàng:\n• Giao hàng toàn quốc từ 2–4 ngày làm việc (nội thành 1–2 ngày).\n• Miễn phí vận chuyển cho đơn từ 500.000 ₫ (dưới 500.000 ₫ phí ship 30.000 ₫).\n• Được kiểm tra hàng trước khi thanh toán.',
      products: [],
      suggestions: ['Phương thức thanh toán', 'Chính sách đổi trả', 'Gợi ý sản phẩm'],
    };
  }
  if (hasAny(text, ['thanh toan', 'cod', 'chuyen khoan', 'tra gop', 'cach mua', 'dat hang'])) {
    return {
      reply: 'Hướng dẫn đặt hàng & thanh toán:\n• Chọn sản phẩm → bấm "Thêm vào giỏ" → vào Giỏ hàng → nhập địa chỉ & số điện thoại → bấm "Đặt hàng".\n• Hiện Shop hỗ trợ thanh toán khi nhận hàng (COD) an toàn và tiện lợi.',
      products: [],
      suggestions: ['Chính sách giao hàng', 'Chính sách bảo hành'],
    };
  }
  if (hasAny(text, ['bao hanh', 'doi tra', 'hoan tien', 'loi san pham'])) {
    return {
      reply: 'Chính sách bảo hành & đổi trả:\n• Tất cả sản phẩm chính hãng được bảo hành 12 tháng.\n• Hỗ trợ đổi trả miễn phí trong 7 ngày nếu sản phẩm có lỗi từ nhà sản xuất hoặc giao sai mẫu.',
      products: [],
      suggestions: ['Liên hệ hỗ trợ', 'Chính sách giao hàng'],
    };
  }
  if (hasAny(text, ['lien he', 'hotline', 'so dien thoai', 'dia chi', 'gio lam viec', 'nhan vien'])) {
    return {
      reply: 'Thông tin liên hệ hỗ trợ:\n• Hotline: 1900 1234 (8:00 – 21:00 tất cả các ngày trong tuần)\n• Email: support@shop.com\n• Địa chỉ: 12 Nguyễn Huệ, Quận 1, TP.HCM',
      products: [],
      suggestions: ['Gợi ý sản phẩm', 'Tra cứu đơn hàng'],
    };
  }
  if (hasAny(text, ['danh muc', 'nhung loai nao', 'ban gi', 'co gi', 'mat hang'])) {
    const names = categories.map((c) => c.name);
    return {
      reply: `Hiện tại Shop đang kinh doanh ${names.length} danh mục: ${names.join(', ')}. Bạn quan tâm đến danh mục nào để mình tư vấn nhé?`,
      products: [],
      suggestions: names.slice(0, 4),
    };
  }
  if (hasAny(text, ['goi y', 'tu van', 'ban chay', 'pho bien', 'nen mua', 'noi bat']) && !matched.length) {
    const picks = products.filter((p) => p.stock > 0).slice(0, 4);
    const list = picks.map((p) => `• ${p.name} — ${vnd(p.price)} (Còn ${p.stock})`).join('\n');
    return {
      reply: `Một số sản phẩm nổi bật gợi ý cho bạn:\n${list}\nBấm vào sản phẩm bên dưới để xem chi tiết nhé!`,
      products: toCards(picks),
      suggestions: ['Điện thoại', 'Laptop', 'Phụ kiện', 'Sản phẩm dưới 1 triệu'],
    };
  }
  if (matched.length) {
    const lines = matched.map((p) => `• ${p.name} (${p.category_name}) — ${vnd(p.price)} [${p.stock > 0 ? `Còn ${p.stock}` : 'Hết hàng'}]`);
    return {
      reply: `Mình tìm thấy ${matched.length} sản phẩm phù hợp:\n${lines.join('\n')}\nBạn có thể bấm trực tiếp vào sản phẩm bên dưới để xem chi tiết và đặt mua.`,
      products: toCards(matched),
      suggestions: ['Chính sách giao hàng', 'Chính sách bảo hành', 'Gợi ý sản phẩm'],
    };
  }
  const { min, max } = extractPriceRange(text);
  if (min !== undefined || max !== undefined) {
    return {
      reply: 'Hiện chưa có sản phẩm nào trong khoảng giá bạn yêu cầu. Bạn có thể tham khảo các sản phẩm giá tốt khác bên dưới nhé!',
      products: toCards(products.filter((p) => p.stock > 0).sort((a, b) => a.price - b.price)),
      suggestions: ['Sản phẩm rẻ nhất', 'Danh mục sản phẩm'],
    };
  }
  return {
    reply: 'Xin lỗi, mình chưa hiểu rõ yêu cầu của bạn. Bạn thử hỏi cụ thể hơn như:\n• Tên sản phẩm: "iPhone 15 giá bao nhiêu?"\n• Theo danh mục & giá: "Laptop dưới 20 triệu", "Phụ kiện"\n• "Tra cứu đơn hàng", "Chính sách giao hàng", "Bảo hành"',
    products: [],
    suggestions: ['Gợi ý sản phẩm', 'Danh mục sản phẩm', 'Sản phẩm dưới 1 triệu', 'Chính sách giao hàng'],
  };
}
