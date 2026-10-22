import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { ZodError } from 'zod';
import { initDb } from './db';
import { api } from './routes';

async function main() {
  await initDb();
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', api);

  // Nếu đã build frontend (client/dist) thì phục vụ luôn -> deploy 1 service
  const dist = path.join(__dirname, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0].message });
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  });

  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`API chạy tại http://localhost:${port}`));
}
main();
