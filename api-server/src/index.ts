import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Test-Route, um zu sehen, ob die API lebt
app.get('/', (req, res) => {
  res.json({ status: 'Mila API läuft einwandfrei!' });
});

// Route 1: Rohdaten empfangen und erstes Schema testen
app.post('/api/ingest', (req, res) => {
  const rawData = req.body;

  // Prüfen, ob überhaupt Daten mitgeschickt wurden
  if (!rawData || Object.keys(rawData).length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Keine Daten empfangen! Bitte Sende-Paket prüfen.' 
    });
  }

  console.log('Mila hat Rohdaten empfangen:', rawData);

  // Einfache automatische Felderkennung (Erster Prototyp der Interpretation)
  const detectedFields = Object.keys(rawData);

  // Rückmeldung an den Aufrufer (z. B. Tablet oder Altsystem)
  res.json({
    success: true,
    message: 'Daten erfolgreich von Mila empfangen!',
    receivedFields: detectedFields,
    processedData: rawData
  });
});

// Server starten
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
