import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Campos requeridos: email, password' });
  }

  try {
    const result = await pool.query(
      `SELECT
         u.id, u.nombre, u.email, u.rol,
         u.sucursal_id,
         u.empresa_id,
         u.idioma, u.tema,
         s.empresa_id AS empresa_id_via_sucursal
       FROM usuarios u
       LEFT JOIN sucursales s ON s.id = u.sucursal_id
       WHERE u.email = $1
         AND u.activo = TRUE
         AND u.password_hash = crypt($2, u.password_hash)`,
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const u = result.rows[0];

    // empresa_id: explicit column (admin_empresa) takes precedence,
    // otherwise derive it from the sucursal JOIN (all roles with a sucursal_id)
    const empresa_id: string | null = u.empresa_id ?? u.empresa_id_via_sucursal ?? null;
    const sucursal_id: string | null = u.sucursal_id ?? null;

    const payload = {
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      sucursal_id,
      empresa_id,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: '8h' });

    res.json({ token, usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, idioma: u.idioma, tema: u.tema } });
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor', detail: String(error) });
  }
};
