const NORTHWIND_SOURCE = {
  id: 'northwind-830',
  name: 'Northwind 830',
  kind: 'pinned_reference',
  mode: 'read_only',
  status: 'ready',
  description: 'Versionierte Northwind-Referenzdaten, die mit PetraPlan ausgeliefert werden.',
  origin: {
    label: 'neo4j-contrib/northwind-neo4j',
    revision: '5db323116a2779434ba0c17eb2b733575bfc2a4',
  },
  identity: {
    databaseType: 'Northwind-Referenzdaten',
    databaseVersion: 'Snapshot 830/2155/91',
    driverName: 'PetraPlan Pinned Source Reader',
    driverVersion: '1',
  },
  structure: {
    tablesKnown: true,
    columnsKnown: true,
    keysKnown: true,
    dataTypesKnown: true,
    nullabilityKnown: true,
  },
  capabilities: [
    { capability: 'Aufträge lesen', support: 'supported', evidence: { level: 'authoritative_metadata', reference: 'pinnedNorthwind.ts: Order- und Kundensnapshot' } },
    { capability: 'Auftragspositionen lesen', support: 'supported', evidence: { level: 'authoritative_metadata', reference: 'pinnedNorthwind.ts: Order-Detail-Snapshot' } },
    { capability: 'Quellwerte unverändert anzeigen', support: 'supported', evidence: { level: 'authoritative_metadata', reference: 'Northwind Detail-API liefert source envelope' } },
    { capability: 'In Quelle schreiben', support: 'unsupported', evidence: { level: 'authoritative_metadata', reference: 'Quelle ist als read_only festgelegt' } },
    { capability: 'Live-Datenbankverbindung', support: 'unsupported', evidence: { level: 'authoritative_metadata', reference: 'Es wird ein ausgelieferter Snapshot gelesen, keine externe Datenbank' } },
  ],
  limits: {
    identifierLength: 'OrderID ist die technische Auftragskennung; Darstellung A-{OrderID}.',
    typeLimits: 'Nur der versionierte Northwind-Snapshot; keine beliebigen Tabellen oder Schreiboperationen.',
    dateTimeRepresentation: 'OrderDate und ShippedDate werden als Northwind-Quellwerte erhalten.',
    driverSpecificRestrictions: ['Kein Schreibzugriff', 'Keine Live-Verbindung', 'Datenstand ist der eingebettete Snapshot'],
  },
} as const;

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    sources: [NORTHWIND_SOURCE],
    principle: 'Eine Quelle wird mit Herkunft, Lesemodus, Fähigkeiten und Grenzen sichtbar gemacht. Nicht vorhandene Live-Verbindungen werden nicht behauptet.',
  });
}
