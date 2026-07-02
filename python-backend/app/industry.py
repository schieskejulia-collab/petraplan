"""
Industry intelligence layer for Mila.

Provides keyword-based industry detection, tool classification,
integration hints, migration suggestions, and automation ideas.
"""

INDUSTRY_KEYWORDS: dict[str, list[str]] = {
    "cleaning":     ["reinigung", "haushalt", "putzen", "objekt", "schichtplan", "reinigungskraft", "gebäude"],
    "care":         ["pflege", "klient", "betreuung", "dienstplan", "pflegeplan", "pflegefachkraft", "sozial"],
    "handwerk":     ["aufmaß", "material", "auftrag", "montage", "reparatur", "werkstatt", "meister", "handwerker"],
    "construction": ["baustelle", "renovierung", "sanierung", "bauplan", "architekt", "bauprojekt"],
    "delivery":     ["lieferung", "tour", "fahrer", "paket", "kurier", "logistik", "transport"],
    "coaching":     ["coaching", "beratung", "session", "termin", "klient", "training", "seminar"],
    "agency":       ["content", "kampagne", "ads", "social media", "briefing", "marketing", "agentur", "kunde"],
    "gastronomy":   ["tisch", "bestellung", "küche", "service", "kasse", "restaurant", "café", "speisekarte"],
    "retail":       ["inventar", "shop", "produkt", "lager", "bestellung", "händler", "kauf", "verkauf"],
    "wellness":     ["termin", "studio", "massage", "beauty", "fitness", "salon", "therapeut"],
}

# old = legacy/manual tools common in that industry
# modern = purpose-built SaaS alternatives
INDUSTRY_TOOLS: dict[str, dict[str, list[str]]] = {
    "cleaning": {
        "old":    ["excel", "whatsapp", "papierzettel", "telefonliste", "word"],
        "modern": ["shiftbase", "timetac", "pipedrive", "trello", "smoobu", "connecteam"],
    },
    "care": {
        "old":    ["excel", "papierakten", "word", "fax"],
        "modern": ["medifox", "vivendi", "carecontrol", "seko", "snap", "tm3"],
    },
    "handwerk": {
        "old":    ["excel", "papieraufträge", "word", "fax"],
        "modern": ["tooltime", "hero", "craftnote", "lexoffice", "orgaMAX", "weclapp"],
    },
    "construction": {
        "old":    ["excel", "papierbaupläne", "word"],
        "modern": ["capmo", "planradar", "procore", "autodesk"],
    },
    "delivery": {
        "old":    ["excel", "whatsapp", "telefon", "papier"],
        "modern": ["bringg", "onfleet", "wolt", "lieferando", "routific"],
    },
    "coaching": {
        "old":    ["word", "excel", "email"],
        "modern": ["notion", "calendly", "zoom", "stripe", "miro", "thinkific"],
    },
    "agency": {
        "old":    ["excel", "email", "word"],
        "modern": ["asana", "clickup", "hubspot", "meta", "hootsuite", "notion"],
    },
    "gastronomy": {
        "old":    ["papierbestellungen", "excel", "telefonbestellung"],
        "modern": ["lightspeed", "gastrofix", "ubereats", "orderbird", "sevdesk"],
    },
    "retail": {
        "old":    ["excel", "papierinventur", "handkasse"],
        "modern": ["shopify", "billbee", "jtl", "woocommerce", "sumup"],
    },
    "wellness": {
        "old":    ["papierkalender", "telefonbuch", "excel"],
        "modern": ["shore", "treatwell", "fitogram", "timify", "bookedin"],
    },
}

INDUSTRY_INTEGRATIONS: dict[str, list[str]] = {
    "cleaning":     ["CSV-Import", "iCal-Sync", "E-Mail-Parsing", "SMS-Benachrichtigung"],
    "care":         ["CSV-Import", "PDF-OCR", "Abrechnungs-API", "Dienstplan-Export"],
    "handwerk":     ["CSV-Export", "PDF-OCR", "DATEV-Export", "E-Rechnung"],
    "construction": ["CSV-Export", "PDF-OCR", "DWG-Export", "Baufortschritt-API"],
    "delivery":     ["REST-API", "Webhooks", "GPS-Tracking", "CSV-Import"],
    "coaching":     ["iCal-Sync", "Webhooks", "Zahlungs-API", "Video-API"],
    "agency":       ["REST-API", "Webhooks", "CSV-Export", "Social-Media-API"],
    "gastronomy":   ["POS-API", "CSV-Export", "PDF-OCR", "Lieferplattform-API"],
    "retail":       ["REST-API", "CSV-Import", "XML-Feed", "Lager-API"],
    "wellness":     ["iCal-Sync", "REST-API", "SMS-Benachrichtigung", "Zahlungs-API"],
}

# Per-industry automation suggestions
INDUSTRY_AUTOMATION: dict[str, list[str]] = {
    "cleaning": [
        "Schichtplanung automatisch aus Kundenbuchungen generieren",
        "Auftragsbestätigung per SMS/E-Mail nach Buchung versenden",
        "Wöchentlichen Stunden- und Kostenbericht automatisch erstellen",
        "Rechnungsstellung nach Auftragsabschluss automatisieren",
    ],
    "care": [
        "Dienstplan-Benachrichtigung automatisch an Mitarbeiter senden",
        "Pflegedokumentation-Erinnerungen täglich automatisieren",
        "Abrechnungsdaten automatisch aus Dienstplänen extrahieren",
        "Neue Klienten-Onboarding-Checkliste automatisch erstellen",
    ],
    "handwerk": [
        "Angebotserstellung aus Auftragsformular automatisieren",
        "Materialbedarf basierend auf Auftrag automatisch berechnen",
        "Rechnungsversand nach Abnahme automatisieren",
        "Kundennachverfolgung 30 Tage nach Auftrag automatisieren",
    ],
    "construction": [
        "Baufortschritts-Update automatisch an Auftraggeber senden",
        "Liefertermine aus Bauplan-Meilensteinen automatisch tracken",
        "Subunternehmer-Koordination per automatischem Dienstplan",
        "Abnahme-Protokoll automatisch aus Checkliste generieren",
    ],
    "delivery": [
        "Tourenplanung nach Lieferadressen automatisch optimieren",
        "Fahrer-Benachrichtigung bei neuen Aufträgen automatisch senden",
        "Statusupdates an Kunden bei Auslieferung automatisieren",
        "Tagesabschluss-Bericht automatisch an Dispatcher senden",
    ],
    "coaching": [
        "Terminbestätigung und -erinnerung automatisch versenden",
        "Rechnung nach Session automatisch an Klienten senden",
        "Follow-up-E-Mail 24h nach Session automatisch senden",
        "Onboarding-Materialien bei Buchung automatisch bereitstellen",
    ],
    "agency": [
        "Briefing-Formular automatisch in Projekt-Tickets umwandeln",
        "Statusbericht wöchentlich automatisch an Kunden versenden",
        "Content-Kalender-Erinnerungen automatisch an Team senden",
        "Rechnungsversand nach Projektabschluss automatisieren",
    ],
    "gastronomy": [
        "Bestellbestätigung automatisch an Küche weiterleiten",
        "Tisch-Reservierungsbestätigung per SMS automatisieren",
        "Tagesabschluss-Kassenbericht automatisch generieren",
        "Inventar-Warnungen bei Mindestbestand automatisch senden",
    ],
    "retail": [
        "Bestellbestätigung und Versandstatus automatisch versenden",
        "Niedrigbestand-Warnung automatisch an Einkauf senden",
        "Retourenabwicklung teilautomatisieren",
        "Kundenbewertungsanfrage nach Kauf automatisch senden",
    ],
    "wellness": [
        "Terminbestätigung und -erinnerung automatisch versenden",
        "Nachbuchungs-Angebot 4 Wochen nach Besuch automatisch senden",
        "Kassenbericht am Tagesende automatisch erstellen",
        "Kundenkarte und Treuepunkte automatisch aktualisieren",
    ],
}

# Cross-industry generic automation ideas (fallback)
GENERIC_AUTOMATION: list[str] = [
    "Wiederkehrende Berichte automatisch per E-Mail versenden",
    "Kundennachrichten auf häufige Fragen automatisch beantworten",
    "Neue Einträge in Formular automatisch in Datenbank speichern",
    "Rechnungsversand nach Leistungserbringung automatisieren",
]

# Maps common legacy tools to modern replacements (cross-industry)
TOOL_MIGRATION: dict[str, list[str]] = {
    "excel":            ["lexoffice", "billbee", "tooltime", "shopify", "notion"],
    "papier":           ["notion", "shore", "capmo", "craftnote"],
    "whatsapp":         ["shiftbase", "bringg", "asana", "connecteam"],
    "word":             ["notion", "hubspot", "google docs"],
    "telefon":          ["calendly", "onfleet", "timify"],
    "fax":              ["e-rechnung", "docusign", "adobe sign"],
    "papierkalender":   ["shore", "timify", "bookedin", "calendly"],
    "papieraufträge":   ["tooltime", "craftnote", "hero"],
    "papierakten":      ["medifox", "carecontrol", "notion"],
    "handkasse":        ["sumup", "lightspeed", "orderbird"],
    "telefonliste":     ["shiftbase", "connecteam"],
    "telefonbestellung":["orderbird", "gastrofix"],
    "papierinventur":   ["billbee", "jtl", "shopify"],
    "papierbaupläne":   ["planradar", "capmo", "procore"],
    "papierbestellungen":["orderbird", "gastrofix", "lightspeed"],
}

# Human-readable industry labels (German)
INDUSTRY_LABELS: dict[str, str] = {
    "cleaning":     "Reinigung & Facility",
    "care":         "Pflege & Betreuung",
    "handwerk":     "Handwerk & Gewerbe",
    "construction": "Bau & Renovierung",
    "delivery":     "Logistik & Lieferung",
    "coaching":     "Coaching & Beratung",
    "agency":       "Marketing & Agentur",
    "gastronomy":   "Gastronomie",
    "retail":       "Handel & Retail",
    "wellness":     "Wellness & Beauty",
}


def detect_industry(text: str) -> str | None:
    """
    Scores each industry by keyword hits in `text`.
    Returns the best-matching industry key, or None if no keywords match.
    """
    text = text.lower()
    scores: dict[str, int] = {
        industry: sum(1 for kw in keywords if kw in text)
        for industry, keywords in INDUSTRY_KEYWORDS.items()
    }
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else None


def detect_tools(text: str) -> list[str]:
    """
    Scans `text` for known old/modern tool names across all industries.
    Returns a deduplicated list of matched tool names.
    """
    text = text.lower()
    found: set[str] = set()
    for groups in INDUSTRY_TOOLS.values():
        for category in ("old", "modern"):
            for tool in groups[category]:
                if tool.lower() in text:
                    found.add(tool)
    return sorted(found)


def detect_integrations(industry: str) -> list[str]:
    """Returns the typical integration formats for a given industry key."""
    return INDUSTRY_INTEGRATIONS.get(industry, [])


def classify_tools(
    tools: list[str], industry: str | None
) -> dict[str, list[str]]:
    """
    Given a list of tool names and an industry key, classifies each tool as
    'old' (legacy) or 'modern' (purpose-built).
    Returns {"old": [...], "modern": [...], "unknown": [...]}.
    """
    result: dict[str, list[str]] = {"old": [], "modern": [], "unknown": []}
    lower_tools = [t.lower() for t in tools]

    # Use industry-specific list when available; fall back to all industries
    candidate_industries = (
        [industry] if industry and industry in INDUSTRY_TOOLS
        else list(INDUSTRY_TOOLS.keys())
    )

    for tool in lower_tools:
        placed = False
        for ind in candidate_industries:
            groups = INDUSTRY_TOOLS[ind]
            if tool in [t.lower() for t in groups["old"]]:
                if tool not in result["old"]:
                    result["old"].append(tool)
                placed = True
                break
            if tool in [t.lower() for t in groups["modern"]]:
                if tool not in result["modern"]:
                    result["modern"].append(tool)
                placed = True
                break
        if not placed and tool not in result["unknown"]:
            result["unknown"].append(tool)

    return result


def migration_suggestions(tools: list[str]) -> dict[str, list[str]]:
    """
    For each legacy tool found in `tools`, returns a list of modern
    alternatives from TOOL_MIGRATION.
    Returns {legacy_tool: [suggestions, ...]}
    """
    lower_tools = [t.lower() for t in tools]
    suggestions: dict[str, list[str]] = {}
    for tool in lower_tools:
        for legacy_key, alts in TOOL_MIGRATION.items():
            if legacy_key in tool:
                suggestions[tool] = alts
                break
    return suggestions


def suggest_automations(industry: str | None, tools_old: list[str]) -> list[str]:
    """
    Returns automation suggestions tailored to the detected industry.
    Falls back to generic suggestions if no industry is detected.
    Up to 4 suggestions are returned.
    """
    if industry and industry in INDUSTRY_AUTOMATION:
        base = INDUSTRY_AUTOMATION[industry][:4]
    else:
        base = GENERIC_AUTOMATION[:4]

    # If many legacy tools found, add a priority hint
    if len(tools_old) >= 2:
        base = [f"Legacy-Tools ablösen: Start mit '{tools_old[0]}' als höchste Priorität"] + base[:3]

    return base
