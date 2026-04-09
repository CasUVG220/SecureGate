import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Campos requeridos: email, password' });
  }

  try {
    // Verify password using pgcrypto's crypt() — same function used to hash in init.sql
    const result = await pool.query(
      `SELECT id, nombre, email, rol
       FROM usuarios
       WHERE email = $1
         AND activo = TRUE
         AND password_hash = crypt($2, password_hash)`,
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const usuario = result.rows[0];
    const payload = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol };
    const token = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '8h' });

    res.json({ token, usuario: payload });
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor', detail: String(error) });
  }
};