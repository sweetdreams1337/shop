import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export const sign = (u: { id: number; role: string }) =>
  jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '7d' });

export const uid = (req: Request): number | undefined => (req as any).user?.id;

// required=false: vẫn đọc token nếu có nhưng không chặn khách
export const auth = (required = true) => (req: Request, res: Response, next: NextFunction) => {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try {
      (req as any).user = jwt.verify(h.slice(7), SECRET);
    } catch {
      /* token sai -> coi như chưa đăng nhập */
    }
  }
  if (required && !(req as any).user) return res.status(401).json({ error: 'Bạn chưa đăng nhập' });
  next();
};

export const adminOnly = (req: Request, res: Response, next: NextFunction) =>
  (req as any).user?.role === 'admin' ? next() : res.status(403).json({ error: 'Không có quyền truy cập' });
