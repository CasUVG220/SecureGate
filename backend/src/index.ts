import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'SecureGate Backend', version: '1.0.0' });
});

app.get('/api/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as tiempo, current_database() as base_datos');
    res.json({
      backend: 'conectado',
      base_datos: 'conectada',
      info: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ backend: 'conectado', base_datos: 'error', error: String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`SecureGate Backend corriendo en puerto ${PORT}`);
});
