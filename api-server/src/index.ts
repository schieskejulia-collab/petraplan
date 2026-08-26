import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Test-Route: Status der API
app.get('/', (req, res) => {
  res.json({ status: 'Mila API läuft einwandfrei!' });
});

// Wörterbuch für das Umschreiben von Altsystem-Feldern auf Mila-Standards
const FIELD_MAPPING = {
  'KUNDEN_NR': 'customerId',
  'NAME': 'lastName',
  'VORNAME': 'firstName',
  'WOHNORT': 'city',
  'ANZAHIL': 'quantity',
  'WKN': 'wkn'
};

// Haupt-Route: Ingestion & Übersetzung
app.post('/api/ingest', (req, res) => {
  const rawData = req.body;

  if (!rawData || Object.keys(rawData).length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Keine Daten empfangen! Bitte Sende-Paket prüfen.' 
    });
  }

  // 1. Spalten / Felder erkennen (Interpretation)
  const rawFields = Object.keys(rawData);
  const transformedData = {};

  // 2. Übersetzen: Alt-Felder in modernes JSON-Schema umwandeln
  rawFields.forEach(field => {
    const cleanKey = FIELD_MAPPING[field] || field.toLowerCase();
    transformedData[cleanKey] = rawData[field];
  });

  // 3. Ergebnis für die Mobile App & Supabase bereitstellen
  res.json({
    success: true,
    message: 'Daten erfolgreich eingelesen und in Mila-Schema übersetzt!',
    meta: {
      originalFieldsCount: rawFields.length,
      detectedSchema: rawFields
    },
    legacyData: rawData,
    milaModel: transformedData
  });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
