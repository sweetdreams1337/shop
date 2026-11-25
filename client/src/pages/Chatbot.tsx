import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, vnd } from '../api';

type ChatProduct = {
  id: number;
  name: string;
  price: number;
  stock: number;
  image_url: string;
  category_name: string;
};

type Msg = {
  role: 'user' | 'bot';
  text: string;
  products?: ChatProduct[];
  suggestions?: string[];
};

const WELCOME: Msg = {
  role: 'bot',
  text: 'Xin chào! Tôi là trợ lý ảo của Shop. Bạn cần tìm sản phẩm, hỏi giá, tra cứu đơn hàng hay xem chính sách giao hàng cứ nhắn mình nhé!',
  suggestions: ['Gợi ý sản phẩm', 'Danh mục sản phẩm', 'Sản phẩm dưới 1 triệu', 'Tra cứu đơn hàng', 'Chính sách giao hàng'],
};

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, open, loading]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || loading) return;
    const next: Msg[] = [...msgs, { role: 'user', text }];
    setMsgs(next);
    setInput('');
    setLoading(true);
    try {
      const history = next.slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const res = await api<{ reply: string; products?: ChatProduct[]; suggestions?: string[] }>('/chat', 'POST', {
        message: text,
        history,
      });
      setMsgs((cur) => [...cur, { role: 'bot', text: res.reply, products: res.products, suggestions: res.suggestions }]);
    } catch (e: any) {
      setMsgs((cur) => [...cur, { role: 'bot', text: e.message || 'Không kết nối được trợ lý, bạn thử lại sau nhé.' }]);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <div className="chat-wrap">
      {open && (
        <div className="chat-box" role="dialog" aria-label="Trợ lý khách hàng">
          <div className="chat-head">
            <span>💬 Trợ lý Shop</span>
            <div className="chat-actions">
              <button type="button" title="Làm mới hội thoại" onClick={() => setMsgs([WELCOME])}>↺</button>
              <button type="button" title="Đóng" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>

          <div className="chat-body">
            {msgs.map((m, idx) => (
              <div key={idx} className={`chat-msg ${m.role}`}>
                <div className="chat-bubble">{m.text}</div>
                {m.products && m.products.length > 0 && (
                  <div className="chat-products">
                    {m.products.map((p) => (
                      <Link key={p.id} to={`/product/${p.id}`} className="chat-prod" onClick={() => setOpen(false)}>
                        <img src={p.image_url} alt={p.name} />
                        <div>
                          <b>{p.name}</b>
                          <div className="price">{vnd(p.price)}</div>
                          <small>{p.stock > 0 ? `Còn ${p.stock}` : 'Hết hàng'}</small>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {idx === msgs.length - 1 && m.suggestions && m.suggestions.length > 0 && !loading && (
                  <div className="chat-sugg">
                    {m.suggestions.map((s) => (
                      <button key={s} type="button" onClick={() => send(s)}>{s}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="chat-msg bot">
                <div className="chat-bubble">Đang trả lời...</div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="chat-foot" onSubmit={onSubmit}>
            <input
              placeholder="Nhập câu hỏi của bạn..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              maxLength={1000}
            />
            <button disabled={loading || !input.trim()}>Gửi</button>
          </form>
        </div>
      )}

      <button
        type="button"
        className="chat-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="Mở hộp thoại hỗ trợ"
      >
        {open ? '✕ Đóng' : '💬 Hỗ trợ'}
      </button>
    </div>
  );
}
