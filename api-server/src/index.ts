import express from 'express';
import cors from 'cors';
import ingestRouter from './routes/ingest.js';
import casesRouter from './routes/cases.js';
import idempotencyRouter from './routes/idempotency.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: configuredOrigins.length > 0 ? configuredOrigins : false,
  }),
);
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.json({ status: 'PetraPlan API is running' });
});

app.use(idempotencyRouter);
app.use(ingestRouter);
app.use(casesRouter);

app.listen(PORT, () => {
  console.log(`PetraPlan API is running on port ${PORT}`);
});
