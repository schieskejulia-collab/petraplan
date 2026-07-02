from .schemas import BusinessProfile
from .industry import (
    detect_industry,
    classify_tools,
    migration_suggestions,
    detect_integrations,
    INDUSTRY_LABELS,
)

# Generic cross-industry tool clusters (kept for broader matching)
TOOL_CLUSTERS: dict[str, list[str]] = {
    "communication":      ["slack", "teams", "discord", "telegram", "zoom", "meet"],
    "project_management": ["notion", "linear", "jira", "asana", "trello", "clickup", "monday"],
    "automation":         ["zapier", "make", "n8n", "integromat", "automate"],
    "crm":                ["hubspot", "salesforce", "pipedrive", "zoho"],
    "analytics":          ["mixpanel", "amplitude", "posthog", "ga", "google analytics", "looker"],
    "development":        ["github", "gitlab", "bitbucket", "vercel", "netlify", "aws", "gcp"],
    "finance":            ["stripe", "quickbooks", "xero", "freshbooks", "sevdesk", "lexoffice"],
    "support":            ["intercom", "zendesk", "freshdesk", "crisp"],
}


def detect_tool_clusters(tools: list[str]) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    lower_tools = [t.lower() for t in tools]
    for cluster, members in TOOL_CLUSTERS.items():
        matched = [t for t in lower_tools if any(m in t for m in members)]
        if matched:
            found[cluster] = matched
    return found


def _build_text_corpus(profile: BusinessProfile) -> str:
    """Combine all free-text fields for keyword scanning."""
    parts = [
        profile.industry or "",
        profile.workflows or "",
        profile.repeated_tasks or "",
        profile.time_wasters or "",
        profile.top_priority or "",
        profile.desired_outcome or "",
        " ".join(profile.tools or []),
    ]
    return " ".join(parts)


def analyze_business(profile: BusinessProfile) -> dict:
    insights: list[str] = []
    risks: list[str] = []
    opportunities: list[str] = []
    recommendations: list[str] = []

    corpus = _build_text_corpus(profile)

    # ââ Industry detection âââââââââââââââââââââââââââââââââââââââââââââââââââ
    detected_industry = detect_industry(corpus)
    industry_label = (
        INDUSTRY_LABELS.get(detected_industry, detected_industry.title())
        if detected_industry
        else profile.industry
    )

    if detected_industry:
        insights.append(f"Branche erkannt: {industry_label}.")
        integrations = detect_integrations(detected_industry)
        if integrations:
            opportunities.append(
                f"Typische IntegrationsmÃ¶glichkeiten fÃ¼r {industry_label}: "
                f"{', '.join(integrations)}."
            )

    # ââ Tool stack âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if not profile.tools:
        risks.append("Kein klares Tool-Stack â Risiko von Chaos und exzessiver Handarbeit.")
        opportunities.append("Definiere ein fokussiertes, minimales Tool-Set.")
        recommendations.append("Beginne mit einem Tool fÃ¼r Aufgaben und einem fÃ¼r Kommunikation.")
    else:
        insights.append(f"Tool-Stack mit {len(profile.tools)} Tools: {', '.join(profile.tools)}.")

        # Generic cluster detection
        clusters = detect_tool_clusters(profile.tools)
        if clusters:
            cluster_str = ", ".join(
                f"{k.replace('_', ' ').title()} ({', '.join(v)})" for k, v in clusters.items()
            )
            insights.append(f"Tool-Cluster erkannt: {cluster_str}.")

        if "automation" in clusters:
            opportunities.append("Automatisierungs-Tools bereits vorhanden â prÃ¼fe bestehende Workflows auf LÃ¼cken.")
        if "communication" not in clusters:
            risks.append("Kein dediziertes Kommunikations-Tool im Stack erkennbar.")
        if len(profile.tools) > 8:
            risks.append(f"Mit {len(profile.tools)} Tools besteht Fragmentierungsgefahr â Kontextwechsel kostet Zeit.")
            recommendations.append("Audit des Tool-Stacks: Ãberschneidungen konsolidieren.")

        # Industry-aware classification
        classified = classify_tools(profile.tools, detected_industry)
        if classified["old"]:
            old_str = ", ".join(classified["old"])
            risks.append(
                f"Legacy-Tools im Einsatz: {old_str}. "
                "Diese sind hÃ¤ufig Quellen manueller Arbeit und Fehler."
            )
            # Migration suggestions
            migrations = migration_suggestions(classified["old"])
            for legacy, alts in migrations.items():
                recommendations.append(
                    f"Ersetze '{legacy}' durch eine der branchenerprobten Alternativen: "
                    f"{', '.join(alts)}."
                )
        if classified["modern"]:
            modern_str = ", ".join(classified["modern"])
            insights.append(f"Moderne Branchentools bereits aktiv: {modern_str}.")

    # ââ Time wasters âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if profile.time_wasters:
        insights.append(f"Zeitfresser gemeldet: {profile.time_wasters}")
        opportunities.append("Automatisiere oder eliminiere niedrigwertige, repetitive AktivitÃ¤ten.")
        recommendations.append(
            f"Dokumentiere jeden Zeitfresser mit Zeitaufwand und weise einen Verantwortlichen zu: "
            f"'{profile.time_wasters}'."
        )

    # ââ Repeated tasks âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if profile.repeated_tasks:
        insights.append(f"Wiederkehrende Aufgaben: {profile.repeated_tasks}")
        if profile.premium_active and profile.user_yes_for_automation:
            recommendations.append(f"Automatisiere jetzt: {profile.repeated_tasks}")
        else:
            opportunities.append("Starke Automatisierungskandidaten â sobald Premium + Zustimmung aktiv.")
            recommendations.append("Dokumentiere HÃ¤ufigkeit und Zeitkosten jeder Aufgabe als Grundlage fÃ¼r Automatisierung.")

    # ââ Top priority âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if profile.top_priority:
        insights.append(f"HauptprioritÃ¤t: {profile.top_priority}")
        recommendations.append(
            f"Richte alle Ãnderungen an der PrioritÃ¤t aus: '{profile.top_priority}'. "
            "Lehne alles ab, das nicht dazu beitrÃ¤gt."
        )

    # ââ Desired outcome ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if profile.desired_outcome:
        insights.append(f"GewÃ¼nschtes Ergebnis: {profile.desired_outcome}")
        opportunities.append("Nutze das Ziel als Nordstern bei Investitionsentscheidungen.")

    # ââ Workflows ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if profile.workflows:
        insights.append(f"Workflow-Beschreibung: {profile.workflows}")
        opportunities.append("Visualisiere Workflow-Schritte um EngpÃ¤sse zu identifizieren.")

    # ââ Team size ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if profile.team_size:
        if profile.team_size == 1:
            risks.append("Solo-Betrieb: Single Point of Failure fÃ¼r alle Unternehmensfunktionen.")
            recommendations.append("Priorisiere Dokumentation und Automatisierung um dich als Flaschenhals zu entfernen.")
        elif profile.team_size <= 5:
            insights.append(f"Kleines Team ({profile.team_size} Personen) â AgilitÃ¤t ist dein Vorteil.")
            recommendations.append("Klare EigentÃ¼merschaft pro Funktion etablieren.")
        else:
            insights.append(f"Team mit {profile.team_size} Personen â Koordinationsaufwand wird zum echten Kostenfaktor.")
            recommendations.append("In dokumentierte Prozesse und geteilte Tools investieren.")

    # ââ Fallback âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if not recommendations:
        recommendations.append("Dokumentiere deine hÃ¤ufigsten tÃ¤glichen Aufgaben und messe den Zeitaufwand.")
        recommendations.append("FÃ¼hre einen 30-Tage-Review-Zyklus ein.")

    automation_allowed = bool(profile.premium_active) and bool(profile.user_yes_for_automation)

    return {
        "summary": (
            f"Analyse abgeschlossen fÃ¼r {profile.business_name}"
            + (f" ({industry_label})" if detected_industry else f" in '{profile.industry}'")
            + ". "
            + (
                "Automatisierung ist aktiv â dein Profil qualifiziert sich fÃ¼r erweiterte Empfehlungen."
                if automation_allowed
                else "Strategische Analyse und manuelle Empfehlungen werden bereitgestellt."
            )
        ),
        "insights": insights,
        "risks": risks,
        "opportunities": opportunities,
        "recommendations": recommendations,
        "automation_allowed": automation_allowed,
        "note": (
            "Automatisierung aktiv â Premium und Zustimmung sind gesetzt."
            if automation_allowed
            else "Nur Analyse. Automatisierung nicht aktiv â Premium oder Zustimmung fehlt."
        ),
    }
