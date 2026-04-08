import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Campos requeridos: email, password' });
  }

  try {
    const result = await pool.query(
      'SELECT id, nombre, email, password_hash, rol FROM usuarios WHERE email = $1 AND activo = TRUE',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado o inactivo' });
    }

    const usuario = result.rows[0];
    const passwordValido = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValido) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const payload = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol };
    const token = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '8h' });

    res.json({ token, usuario: payload });
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor', detail: String(error) });
  }
};