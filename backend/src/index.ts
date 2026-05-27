import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'SecureGate Backend', version: '1.0.0' });
});

app.use('/api', apiRouter);

app.listen(PORT, () => {
  console.log(`SecureGate Backend corriendo en puerto ${PORT}`);
});
