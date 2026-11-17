# PDF-Abweichungen und unlesbare Sichtbeträge · Prozessentwurf

Status vom 17. November 2026. Dieser Text beschreibt einen vorgeschlagenen betrieblichen Ablauf. Die technische Umsetzung mit unabhängigem Entscheider ist inzwischen vorhanden; der separate [Implementierungsnachweis](invoice-pdf-exception-implementation.md) beschreibt ihren engeren Geltungsbereich und die noch offene gehostete Abnahme.

## Anlass und Zuständigkeit

Der Fall gelangt in die Ausnahmeprüfung, wenn die sichtbare PDF-Darstellung vom strukturierten Rechnungsinhalt abweicht oder die Sichtprüfung keinen eindeutigen Zahlbetrag ergibt. Er bleibt dem Original-PDF, dem eingebetteten XML und dem KoSIT-Bericht derselben Fassung zugeordnet.

Ein Uploader oder technischer Reviewer darf die Klärung anfordern und Belege ergänzen. Die Entscheidung über die fachliche Verwendung trifft eine für den konkreten Geschäftsprozess benannte Person, beispielsweise die zuständige Rechnungsprüfung. Die Zuständigkeit und ihr Geltungsbereich müssen vor Nutzung dieser Ausnahmefunktion dokumentiert sein. Der Entwurf sieht für die Ausnahme eine zweite berechtigte Person vor. Die technische Umsetzung erzwingt die Unabhängigkeit für die aktuelle Fassung einschließlich früherer Reviewer.

## Prüfung und Entscheidung

Die entscheidende Person prüft den tatsächlichen Originalbeleg, die XML-Felder, das technische Ergebnis und die Begründung der Abweichung. Ein fehlender OCR-Treffer, ein Bruttovergleich und eine tatsächliche Abweichung des Zahlbetrags werden als unterschiedliche Befunde dokumentiert. Auch Skonto, bereits bezahlte Beträge und Rundung sind nur mit einem zum konkreten Feld passenden Nachweis eine Erklärung.

Mögliche Ergebnisse sind eine Rückfrage mit weiter bestehender Sperre, eine Ablehnung oder eine begrenzte Verwendung des geprüften XML-Werts für einen ausdrücklich benannten Zweck. Bei einer begrenzten Verwendung müssen die fachliche Zuständigkeit, die geprüfte Grundlage, die Abweichung, die Begründung und die erlaubte Folgehandlung eindeutig feststehen. Die anschließende Freigabe bleibt eine gesonderte Entscheidung. Die ursprüngliche Sichtabweichung bleibt im Fall erkennbar.

Eine ungeklärte Cent-Abweichung wird nicht automatisch toleriert. Die verantwortliche Person braucht einen Nachweis, welche Größen verglichen werden und wie die Differenz zustande kommt. Ein bloßer Hinweis auf XML-Vorrang erklärt die Ursache der Differenz noch nicht.

## Protokoll

Der fachliche Zielumfang umfasst:

- Fall-ID und Snapshot-ID mit SHA-256 von Original-PDF, XML und KoSIT-Bericht.
- Betroffene Feldnummer und XML-Fundstelle, sichtbarer Wert oder Unlesbarkeit sowie Seite und Belegausschnitt.
- Technischer Befund einschließlich KoSIT-Meldungen, OCR-Methode und Kandidaten.
- Identität der anfordernden und entscheidenden Personen samt dokumentierter Zuständigkeit.
- Begründung, verwendete Nachweise, Ergebnis und erlaubter Verwendungszweck.
- Zeitpunkt, darauf bezogene neue Validierung und getrennte Freigabeentscheidung.

Jede neue Fassung oder jeder relevante Belegwiderruf verlangt eine erneute Prüfung. Frühere Originale und Ausnahmeentscheidungen bleiben in der Historie erhalten.

## Offener weclapp-Fall

In der bisherigen Probe steht der sichtbaren PDF-Endsumme 963,12 ein XML-Bruttobetrag von 963,11 gegenüber. Eine eigene Zahlbetrag-Zeile wurde nicht gefunden; zusätzlich ist Skonto dargestellt. Der Grund des Unterschieds ist offen. Vor einer Entscheidung müssen Bruttobetrag, Zahlbetrag, Skonto und Rundungsangaben mit ihren jeweiligen Fundstellen abgeglichen werden. Die Ursache ist bisher nicht als OCR-Fehler oder zulässige Rundung bestätigt.

Die rechtliche Einordnung und die betrieblich zulässige Folgehandlung sind bei der konkreten Einführung mit der verantwortlichen Fachstelle festzulegen. Dieser Entwurf dokumentiert Zuständigkeit und Belegprüfung.
