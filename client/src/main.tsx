import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Home from './pages/Home';
import ProductPage from './pages/Product';
import Cart from './pages/Cart';
import Orders from './pages/Orders';
import Login from './pages/Login';
import Admin from './pages/Admin';
import './styles.css';

function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <>
      <header>
        <Link to="/" className="logo">🛒 Shop</Link>
        <nav>
          <Link to="/cart">Giỏ hàng</Link>
          {user && <Link to="/orders">Đơn hàng</Link>}
          {user?.role === 'admin' && <Link to="/admin">Quản trị</Link>}
          {user ? (
            <>
              <span className="hi">Xin chào, {user.name}</span>
              <button onClick={() => { logout(); nav('/'); }}>Đăng xuất</button>
            </>
          ) : (
            <Link to="/login">Đăng nhập</Link>
          )}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/product/:id" element={<ProductPage />} />
          <Route path="/cart" element={user ? <Cart /> : <Navigate to="/login" />} />
          <Route path="/orders" element={user ? <Orders /> : <Navigate to="/login" />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={user?.role === 'admin' ? <Admin /> : <Navigate to="/" />} />
        </Routes>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Layout />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
