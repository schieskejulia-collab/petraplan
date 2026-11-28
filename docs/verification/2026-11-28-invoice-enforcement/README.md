# Verbindliche Dublettenprüfung: aktueller Nachweis

Stand 28.11.2026; Fortsetzung von PR #66 auf `f27519c`.
Implementierungsvertrag und Grenzen: [Sicherheitsvertrag](../../invoice-duplicate-enforcement-design.md).
Kein Merge, keine Live-Migration, keine Bereitstellung, keine Zahlung.

Lokal bestanden: 197 Backendtests und 272 Entscheidungs-/Integritätstests ohne
übersprungene Tests im ressourcenbestückten Lauf. Die drei neuen Integrationstests
prüfen Freigabebindung/Bestandsänderung, Kopiensperre mit unabhängiger Referenzwahl
sowie serverseitige API-Bewertung und Rechte. Builds und Frontend-Typprüfung bestanden.

`browser-results.json` enthält zehn bestandene Bedingungen aus einem neuen
Handybrowserlauf. Gepinnte öffentliche Rechnung `01.01a.xml` mit kontrolliert
hinzugefügter Empfänger-VAT-Kennung wird durch den tatsächlichen KoSIT-Worker
akzeptiert. Ohne vollständige Parteienmerkmale wäre die positive Entscheidung
weiter gesperrt; die Produktregeln werden nicht an das Muster gelockert.

Geprüft: Quellenreview ohne Dublettenentscheidung bleibt ohne Freigabeschaltfläche;
CLEAR erzeugt kein Zertifikat; eine gesonderte Freigabe bindet den Entscheid.
Eine spätere Kopie macht die alte Freigabe in Fallansicht und Fallliste BLOCKED.
Die Kopie wird DUPLICATE, eine unabhängige ausdrücklich bestellte Testidentität
wählt PRIMARY, widerruft die alte Freigabe und gibt separat neu frei. Zwei
Zertifikate und der alte Widerruf bleiben erhalten. HOLD an der Kopie macht
anschließend auch die Referenzfreigabe unbrauchbar. Kein JavaScript-Fehler,
kein horizontaler Überlauf bei 390 × 844.

Die Anmeldung ist ein lokaler Testadapter, die Datenbank PGlite. Das ist keine
gehostete Anmeldung oder Identitätsprüfung verschiedener Menschen.

Die fünf zusätzlichen PostgreSQL-17-Tests verwenden getrennte Verbindungen:
Erfassung gewinnt vor Freigabe, Erfassung rollt zurück, Freigabe gewinnt vor
Erfassung, HOLD gewinnt vor Freigabe, REPEATABLE READ wird abgewiesen. Dieser
Nachweis ist erst mit dem erfolgreichen CI-Lauf des veröffentlichten Commits
erbracht. Bis dahin bleibt die Parallelitätsabnahme ausdrücklich offen.

Der bisherige 40-Bedingungen-Rechnungslauf und der Worker-Container werden in CI
zusätzlich unverändert geprüft. Die Pipeline archiviert beide Browserberichte.
Die genaue CI-Zuordnung wird im PR festgehalten; fehlgeschlagene Vercel-Deployments
aufgrund der bestehenden Kontosperre werden nicht als bestandene Bereitstellung
umgedeutet. Die gehostete Gesamtabnahme bleibt offen.
