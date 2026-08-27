import { Request, Response } from 'express';
import pool from '../db/pool';
import { tenantFilter, ownershipClause, ownershipParams } from '../utils/tenant';
import { censurarTexto } from '../utils/profanityFilter';

const TIPOS = ['mantenimiento', 'queja', 'seguridad', 'otro'];

const isResidente = (req: Request) => req.user!.rol === 'residente';

// Resuelve el residente_id del usuario autenticado (o null si no es residente)
const getResidenteId = async (usuario_id: string): Promise<{ id: string; sucursal_id: string } | null> => {
  const r = await pool.query('SELECT id, sucursal_id FROM residentes WHERE usuario_id = $1', [usuario_id]);
  return r.rows[0] ?? null;
};

// ── Residente ────────────────────────────────────────────────────────────────

export const createTicket = async (req: Request, res: Response) => {
  const { tipo, titulo, mensaje } = req.body;
  if (!tipo || !titulo || !mensaje) {
    return res.status(400).json({ error: 'Campos requeridos: tipo, titulo, mensaje' });
  }
  if (!TIPOS.includes(tipo)) {
    return res.status(400).json({ error: 'tipo debe ser: mantenimiento, queja, seguridad u otro' });
  }

  const residente = await getResidenteId(req.user!.id);
  if (!residente) {
    return res.status(403).json({ error: 'Solo un residente puede crear tickets' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketResult = await client.query(
      `INSERT INTO tickets (sucursal_id, residente_id, tipo, titulo)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [residente.sucursal_id, residente.id, tipo, titulo]
    );
    const ticket = ticketResult.rows[0];

    // Mensaje inicial del residente: leido_residente=TRUE, leido_admin=FALSE
    await client.query(
      `INSERT INTO ticket_mensajes (ticket_id, autor_id, mensaje, leido_admin, leido_residente)
       VALUES ($1, $2, $3, FALSE, TRUE)`,
      [ticket.id, req.user!.id, censurarTexto(mensaje)]
    );

    await client.query('COMMIT');
    res.status(201).json(ticket);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al crear ticket', detail: String(error) });
  } finally {
    client.release();
  }
};

export const getMisTickets = async (req: Request, res: Response) => {
  const residente = await getResidenteId(req.user!.id);
  if (!residente) {
    return res.status(403).json({ error: 'Solo un residente tiene tickets propios' });
  }
  try {
    const result = await pool.query(
      `SELECT tk.*,
              lm.mensaje    AS ultimo_mensaje,
              lm.created_at AS ultimo_mensaje_at,
              (SELECT COUNT(*) FROM ticket_mensajes m
               WHERE m.ticket_id = tk.id AND m.leido_residente = FALSE) AS no_leidos
       FROM tickets tk
       LEFT JOIN LATERAL (
         SELECT mensaje, created_at FROM ticket_mensajes m
         WHERE m.ticket_id = tk.id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON TRUE
       WHERE tk.residente_id = $1
       ORDER BY tk.updated_at DESC`,
      [residente.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tickets', detail: String(error) });
  }
};

// ── Admin / staff ────────────────────────────────────────────────────────────

export const getTickets = async (req: Request, res: Response) => {
  const ts = tenantFilter(req.user!, 'tk');
  try {
    const result = await pool.query(
      `SELECT tk.*,
              r.numero_casa,
              u.nombre AS residente_nombre,
              lm.mensaje    AS ultimo_mensaje,
              lm.created_at AS ultimo_mensaje_at,
              (SELECT COUNT(*) FROM ticket_mensajes m
               WHERE m.ticket_id = tk.id AND m.leido_admin = FALSE) AS no_leidos
       FROM tickets tk
       JOIN residentes r ON tk.residente_id = r.id
       JOIN usuarios   u ON r.usuario_id    = u.id
       LEFT JOIN LATERAL (
         SELECT mensaje, created_at FROM ticket_mensajes m
         WHERE m.ticket_id = tk.id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON TRUE
       ${ts.joinClause}
       WHERE ${ts.whereClause}
       ORDER BY tk.updated_at DESC`,
      ts.params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tickets', detail: String(error) });
  }
};

// Carga un ticket verificando acceso según rol. Devuelve el ticket o null.
const loadTicketAuthorized = async (req: Request, ticketId: string) => {
  if (isResidente(req)) {
    const residente = await getResidenteId(req.user!.id);
    if (!residente) return null;
    const r = await pool.query(
      'SELECT * FROM tickets WHERE id = $1 AND residente_id = $2',
      [ticketId, residente.id]
    );
    return r.rows[0] ?? null;
  }
  // staff: verificar scope de tenant
  const r = await pool.query(
    `SELECT * FROM tickets tk
     WHERE tk.id = $1 AND ${ownershipClause('tk', 2)}`,
    [ticketId, ...ownershipParams(req.user!)]
  );
  return r.rows[0] ?? null;
};

export const getMensajes = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const ticket = await loadTicketAuthorized(req, id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket no encontrado o sin acceso' });
    }

    // Abrir el chat marca como leídos los mensajes para el rol que consulta
    if (isResidente(req)) {
      await pool.query(
        `UPDATE ticket_mensajes SET leido_residente = TRUE
         WHERE ticket_id = $1 AND leido_residente = FALSE`,
        [id]
      );
    } else {
      await pool.query(
        `UPDATE ticket_mensajes SET leido_admin = TRUE
         WHERE ticket_id = $1 AND leido_admin = FALSE`,
        [id]
      );
    }

    const mensajes = await pool.query(
      `SELECT m.id, m.ticket_id, m.autor_id, m.mensaje, m.created_at,
              m.leido_admin, m.leido_residente,
              u.nombre AS autor_nombre, u.rol AS autor_rol
       FROM ticket_mensajes m
       JOIN usuarios u ON m.autor_id = u.id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
      [id]
    );
    res.json({ ticket, mensajes: mensajes.rows });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener mensajes', detail: String(error) });
  }
};

export const addMensaje = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { mensaje } = req.body;
  if (!mensaje || !String(mensaje).trim()) {
    return res.status(400).json({ error: 'El mensaje es requerido' });
  }

  try {
    const ticket = await loadTicketAuthorized(req, id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket no encontrado o sin acceso' });
    }

    // Un residente no puede escribir en un ticket cerrado
    if (isResidente(req) && ticket.estado === 'cerrado') {
      return res.status(409).json({ error: 'El ticket está cerrado' });
    }

    const residenteAutor = isResidente(req);
    // residente: leido_residente=TRUE, leido_admin=FALSE ; staff: al revés
    const leidoAdmin     = residenteAutor ? false : true;
    const leidoResidente = residenteAutor ? true  : false;

    const inserted = await pool.query(
      `INSERT INTO ticket_mensajes (ticket_id, autor_id, mensaje, leido_admin, leido_residente)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, req.user!.id, censurarTexto(mensaje), leidoAdmin, leidoResidente]
    );

    // Al responder el staff, un ticket 'abierto' pasa a 'en_proceso'
    const nuevoEstado = (!residenteAutor && ticket.estado === 'abierto') ? 'en_proceso' : ticket.estado;
    await pool.query(
      `UPDATE tickets SET updated_at = NOW(), estado = $2 WHERE id = $1`,
      [id, nuevoEstado]
    );

    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al enviar mensaje', detail: String(error) });
  }
};

export const cerrarTicket = async (req: Request, res: Response) => {
  const { id } = req.params;
  // Sólo staff — nunca un residente
  if (isResidente(req)) {
    return res.status(403).json({ error: 'Un residente no puede cerrar tickets' });
  }
  try {
    const result = await pool.query(
      `UPDATE tickets
       SET estado = 'cerrado', updated_at = NOW()
       WHERE id = $1 AND ${ownershipClause('tickets', 2)}
       RETURNING *`,
      [id, ...ownershipParams(req.user!)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado o sin acceso' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al cerrar ticket', detail: String(error) });
  }
};
