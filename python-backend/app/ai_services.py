import os
import json
from groq import Groq
from .schemas import BusinessProfile
from .industry import (
    detect_industry,
    classify_tools,
    detect_integrations,
    migration_suggestions,
    suggest_automations,
    INDUSTRY_LABELS,
)
from .logger import log

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

MODEL = "llama-3.3-70b-versatile"

SYSTEM_PROMPT = (
    "Du bist Mila, eine präzise und empathische Business-Beraterin für KMUs. "
    "Du kennst typische Branchen-Tools, Legacy-Software und konkrete Automatisierungsoptionen. "
    "Du antwortest immer nur mit validem JSON, ohne Markdown-Codeblöcke oder Erklärungen. "
    "Deine Empfehlungen sind spezifisch, umsetzbar und auf die jeweilige Branche zugeschnitten."
)


def _build_industry_context(profile: BusinessProfile) -> str:
    """Build a structured industry-intelligence block to inject into the prompt."""
    corpus = " ".join(filter(None, [
        profile.industry,
        profile.workflows,
        profile.repeated_tasks,
        profile.time_wasters,
        profile.top_priority,
        " ".join(profile.tools or []),
    ]))

    detected = detect_industry(corpus)
    label = INDUSTRY_LABELS.get(detected, detected.title()) if detected else None
    classified = classify_tools(profile.tools or [], detected)
    integrations = detect_integrations(detected) if detected else []
    migrations = migration_suggestions(classified["old"]) if classified["old"] else {}
    automations = suggest_automations(detected, classified["old"])

    lines: list[str] = []
    if detected:
        lines.append(f"## Erkannte Branche: {label} (Schlüssel: {detected})")
    if classified["old"]:
        lines.append(f"- Legacy-Tools erkannt: {', '.join(classified['old'])}")
        lines.append("  → Diese Tools sind typische Quellen für manuelle Fehler und Zeitverlust.")
    if classified["modern"]:
        lines.append(f"- Moderne Branchentools bereits aktiv: {', '.join(classified['modern'])}")
    if migrations:
        for legacy, alts in migrations.items():
            lines.append(f"- Migration empfohlen: '{legacy}' → konkrete Alternativen: {', '.join(alts)}")
    if integrations:
        lines.append(f"- Typische Integrationen für {label}: {', '.join(integrations)}")
    if automations:
        lines.append("- Sofort umsetzbare Automatisierungen für diese Branche:")
        for a in automations[:3]:
            lines.append(f"  • {a}")

    return "\n".join(lines) if lines else ""


def _build_prompt(profile: BusinessProfile) -> str:
    tools_str = ", ".join(profile.tools) if profile.tools else "keine angegeben"
    industry_ctx = _build_industry_context(profile)
    automation_allowed = bool(profile.premium_active) and bool(profile.user_yes_for_automation)

    sections = [
        "Analysiere das folgende Unternehmensprofil als erfahrene Business-Beraterin.",
        "Antworte ausschließlich als JSON — keine Erklärungen außerhalb des JSON-Blocks.",
        "",
        "## Unternehmensprofil",
        f"- Name: {profile.business_name}",
        f"- Branche: {profile.industry}",
        f"- Teamgröße: {profile.team_size or 'unbekannt'}",
        f"- Tools: {tools_str}",
        f"- Workflows: {profile.workflows or 'nicht beschrieben'}",
        f"- Wiederkehrende Aufgaben: {profile.repeated_tasks or 'keine'}",
        f"- Zeitfresser: {profile.time_wasters or 'keine'}",
        f"- Hauptpriorität: {profile.top_priority or 'keine'}",
        f"- Gewünschtes Ergebnis: {profile.desired_outcome or 'nicht angegeben'}",
        f"- Premium aktiv: {'Ja' if profile.premium_active else 'Nein'}",
        f"- Automatisierung erlaubt: {'Ja' if automation_allowed else 'Nein'}",
    ]

    if industry_ctx:
        sections += ["", "## Branchen-Kontext (automatisch erkannt)", industry_ctx]

    sections += [
        "",
        "## Anweisungen",
        "1. Erkenne das konkrete Problem — keine allgemeinen Floskeln",
        "2. Nenne Legacy-Tools direkt beim Namen und empfehle konkrete Alternativen mit Preispunkt wenn bekannt",
        "3. Richte alle Empfehlungen an der Hauptpriorität aus",
        "4. Bei Automatisierung erlaubt=Ja: gib 2-3 spezifische Automatisierungsschritte an (Trigger → Aktion → Ergebnis)",
        "5. Mindestens 3 Einträge pro Liste, maximal 5",
        "6. note: prägnante, persönliche Beobachtung in 1 Satz (nicht 'Automatisierung aktiv')",
        "",
        "## JSON-Format",
        json.dumps({
            "summary": "Warme, direkte Zusammenfassung in 2-3 Sätzen — spricht das größte Problem an",
            "insights": [
                "Konkreter Befund mit Bezug auf das Unternehmen",
                "Tool/Workflow-spezifische Beobachtung",
                "Branchenspezifischer Kontext"
            ],
            "risks": [
                "Konkretes Risiko mit möglicher Konsequenz",
                "Engpass oder Abhängigkeit die das Wachstum blockiert"
            ],
            "opportunities": [
                "Konkrete Chance mit geschätztem Impact (Zeit/Geld/Qualität)",
                "Branchentrend der genutzt werden könnte"
            ],
            "recommendations": [
                "Sofortmaßnahme: [spezifische Aktion] — erwartetes Ergebnis",
                "Kurzfristig (1-4 Wochen): [konkreter Schritt]",
                "Mittelfristig (1-3 Monate): [strategischer Schritt]"
            ],
            "note": "Persönliche Beobachtung — das wichtigste was du jetzt wissen musst"
        }, ensure_ascii=False, indent=2),
        "",
        "Antworte NUR mit dem JSON-Objekt.",
    ]

    return "\n".join(sections)


def _parse_llm_json(raw: str) -> dict:
    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    # Find first { ... } block in case of preamble text
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


def _make_result(data: dict, automation_allowed: bool) -> dict:
    """Normalize LLM output to the AnalysisResult schema."""
    note_raw = data.get("note", "")
    # Never expose the boring default note — replace if it's our placeholder
    if not note_raw or "Automatisierung" in note_raw and len(note_raw) < 60:
        note_raw = data.get("summary", "")[:120]

    return {
        "summary":          data.get("summary", ""),
        "insights":         data.get("insights", []),
        "risks":            data.get("risks", []),
        "opportunities":    data.get("opportunities", []),
        "recommendations":  data.get("recommendations", []),
        "automation_allowed": automation_allowed,
        "note":             note_raw,
    }


def ai_analyze_business(profile: BusinessProfile) -> dict:
    log.info("AI analyze (blocking) — %s / %s", profile.business_name, profile.industry)
    automation_allowed = bool(profile.premium_active) and bool(profile.user_yes_for_automation)

    chat = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_prompt(profile)},
        ],
        max_tokens=1500,
        temperature=0.65,
    )

    raw = chat.choices[0].message.content
    log.debug("LLM raw response: %s", raw[:300])
    data = _parse_llm_json(raw)
    return _make_result(data, automation_allowed)


def ai_analyze_stream(profile: BusinessProfile):
    """
    Generator yielding SSE-formatted chunks from the Groq streaming API.
    Each chunk:  data: {"token": "..."}\\n\\n
    Final chunk: data: {"done": true, "automation_allowed": bool}\\n\\n
    """
    log.info("AI analyze (stream) — %s / %s", profile.business_name, profile.industry)
    automation_allowed = bool(profile.premium_active) and bool(profile.user_yes_for_automation)

    stream = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_prompt(profile)},
        ],
        max_tokens=1500,
        temperature=0.65,
        stream=True,
    )

    for chunk in stream:
        token = chunk.choices[0].delta.content
        if token:
            yield f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"

    yield f"data: {json.dumps({'done': True, 'automation_allowed': automation_allowed})}\n\n"
