import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [isReg, setIsReg] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      if (isReg) await register(name, email, password); else await login(email, password);
      nav('/');
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <form className="box form" onSubmit={submit}>
      <h2>{isReg ? 'Đăng ký' : 'Đăng nhập'}</h2>
      {isReg && <input placeholder="Họ tên" value={name} onChange={(e) => setName(e.target.value)} required />}
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" placeholder="Mật khẩu (≥ 6 ký tự)" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {err && <p className="err">{err}</p>}
      <button>{isReg ? 'Đăng ký' : 'Đăng nhập'}</button>
      <a href="#" onClick={(e) => { e.preventDefault(); setIsReg(!isReg); setErr(''); }}>
        {isReg ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'}
      </a>
      <small>Demo: admin@shop.com / admin123 — user@shop.com / user123</small>
    </form>
  );
}
