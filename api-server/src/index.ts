import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'Mila API läuft einwandfrei!' });
});

// Wörterbuch für SAP- standardisierte Felder
const FIELD_MAPPING = {
  'KUNDEN_NR': 'customerId',
  'NAME': 'lastName',
  'VORNAME': 'firstName',
  'WOHNORT': 'city',
  'ANZAHIL': 'quantity',
  'WKN': 'wkn'
};

// Route: Multi-Ingestion (Daten & Altsystem-Code)
app.post('/api/ingest', (req, res) => {
  const { sourceType, content } = req.body;

  if (!content) {
    return res.status(400).json({ 
      success: false, 
      message: 'Kein Inhalt (content) übergeben!' 
    });
  }

  // FALL A: Klassischer Datensatz (JSON / Tabellenzeile)
  if (sourceType === 'DATA_ROW' || !sourceType) {
    const rawFields = Object.keys(content);
    const transformedData = {};

    rawFields.forEach(field => {
      const cleanKey = FIELD_MAPPING[field] || field.toLowerCase();
      transformedData[cleanKey] = content[field];
    });

    return res.json({
      success: true,
      type: 'DATA_PARSED',
      message: 'Datensatz erfolgreich ins Mila-Schema strukturiert',
      milaModel: transformedData
    });
  }

  // FALL B: Altsystem-Code / Doku (ABAP, HTMLBusiness, Tabellen-Exports)
  if (sourceType === 'LEGACY_CODE') {
    // Einfche Muster-Erkennung für ABAP / Dynpro
    const containsTableDef = content.includes('TRANSPARENTE TABELLE') || content.includes('ZKUNDEN');
    const containsPAI = content.includes('USER_COMMAND') || content.includes('WHEN');

    return res.json({
      success: true,
      type: 'CODE_ANALYSIS',
      message: 'Legacy-Code erfolgreich analysiert',
      analysis: {
        detectedType: containsTableDef ? 'SAP Data Dictionary (Tabelle)' : containsPAI ? 'ABAP Dynpro Logik (PAI)' : 'Unbekannter Legacy-Code',
        hasTableDefinition: containsTableDef,
        hasBusinessLogic: containsPAI,
        rawSnippet: content.substring(0, 100) + '...'
      }
    });
  }

  res.status(400).json({ success: false, message: 'Unbekannter sourceType' });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
