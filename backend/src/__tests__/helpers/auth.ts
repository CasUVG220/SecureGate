import request from 'supertest';
import type { Express } from 'express';

export const PASSWORD = 'Prueba#2026a';

export interface Sesion {
  status: number;
  token?: string;
  /** "refresh_token=<valor>" listo para la cabecera Cookie. */
  cookie?: string;
  setCookie: string[];
  body: any;
}

export const login = async (app: Express, email: string, password = PASSWORD): Promise<Sesion> => {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  const setCookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []);
  const cookie = setCookie.find(c => c.startsWith('refresh_token='))?.split(';')[0];
  return { status: r.status, token: r.body?.token, cookie, setCookie, body: r.body };
};

export const bearer = (token?: string) => ({ Authorization: `Bearer ${token}` });
