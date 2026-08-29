import express from 'express';
import cors from 'cors';
import ingestRouter from './routes/ingest.js';
import ingestionLogsRouter from './routes/ingestionLogs.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.json({ status: 'Mila API is running' });
});

app.use(ingestRouter);
app.use(ingestionLogsRouter);

app.listen(PORT, () => {
  console.log(`Mila API is running on port ${PORT}`);
});
