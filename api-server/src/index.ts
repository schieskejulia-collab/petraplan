import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Supabase-Verbindung herstellen
// (Nimmt automatisch die Umgebungsvariablen von Vercel/Railway)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/', (req, res) => {
  res.json({ status: 'Mila API läuft einwandfrei und ist bereit!' });
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

// Route: Multi-Ingestion mit Speicherung in Supabase
app.post('/api/ingest', async (req, res) => {
  const { sourceType, content, processId } = req.body;

  if (!content) {
    return res.status(400).json({ 
      success: false, 
      message: 'Kein Inhalt (content) übergeben!' 
    });
  }

  let resultPayload = {};
  let detectedType = '';

  // FALL A: Klassischer Datensatz (JSON / Tabellenzeile)
  if (sourceType === 'DATA_ROW' || !sourceType) {
    const rawFields = Object.keys(content);
    const transformedData = {};

    rawFields.forEach(field => {
      const cleanKey = FIELD_MAPPING[field] || field.toLowerCase();
      transformedData[cleanKey] = content[field];
    });

    detectedType = 'DATA_PARSED';
    resultPayload = {
      message: 'Datensatz erfolgreich ins Mila-Schema strukturiert',
      milaModel: transformedData
    };
  }

  // FALL B: Altsystem-Code / Doku (ABAP, HTMLBusiness, Tabellen-Exports)
  if (sourceType === 'LEGACY_CODE') {
    const containsTableDef = content.includes('TRANSPARENTE TABELLE') || content.includes('ZKUNDEN');
    const containsPAI = content.includes('USER_COMMAND') || content.includes('WHEN');

    detectedType = 'CODE_ANALYSIS';
    resultPayload = {
      detectedType: containsTableDef ? 'SAP Data Dictionary (Tabelle)' : containsPAI ? 'ABAP Dynpro Logik (PAI)' : 'Unbekannter Legacy-Code',
      hasTableDefinition: containsTableDef,
      hasBusinessLogic: containsPAI,
      rawSnippet: content.substring(0, 100) + '...'
    };
  }

  // 3. Dauerhaftes Speichern in Supabase (Ingestion Log / Akte)
  try {
    if (supabaseUrl && supabaseKey) {
      await supabase
        .from('ingestion_logs')
        .insert([
          { 
            process_id: processId || 'default-process',
            source_type: sourceType || 'DATA_ROW',
            result_type: detectedType,
            payload: resultPayload,
            created_at: new Date().toISOString()
          }
        ]);
    }
  } catch (dbError) {
    console.error('Supabase-Speicherung fehlgeschlagen (läuft ohne Abbruch weiter):', dbError);
  }

  // Rückmeldung an den Aufrufer
  res.json({
    success: true,
    type: detectedType,
    data: resultPayload
  });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
