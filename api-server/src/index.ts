import express from 'express';
import cors from 'cors';

const app = express();

// Wichtig: CORS erlauben, damit dein Frontend (z.B. Port 5173) 
// auf deinen Server (z.B. Port 3000) zugreifen darf
app.use(cors());
app.use(express.json());

// Die Brücke zum Python-Backend
app.post('/api/analyze', async (req, res) => {
  try {
    // Weiterleitung an das Python Backend
    const response = await fetch('http://localhost:8000/api/ai-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    // Fehler vom Python-Backend durchreichen
    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).json(errorData);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Python-Backend nicht erreichbar:', error);
    res.status(503).json({ error: 'Backend-Dienst nicht verfügbar' });
  }
});

app.listen(3000, () => console.log('API Server bereit auf Port 3000'));
