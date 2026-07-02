"""
Mila Backend v2.2 — FastAPI
All routes mounted under /api prefix (Replit proxy compatible).

Endpoints:
  GET  /api/              System info
  GET  /api/health        Health check
  POST /api/analyze       Regelbasierte Analyse
  POST /api/ai-analyze    KI-Analyse (Groq, blockend)
  POST /api/ai-analyze/stream  KI-Analyse (SSE)
  GET  /api/history       Paginierte History
  GET  /api/history/{id}  Einzelne Analyse
  DEL  /api/history/{id}  Analyse löschen
  POST /api/webhook/stripe     Stripe-Events
  POST /api/webhook/premium    Interne Premium-Events
  GET  /api/webhook/events     Empfangene Events
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from pydantic import BaseModel
from .schemas import BusinessProfile, AnalysisResult
from .services import analyze_business
from .ai_services import ai_analyze_business, ai_analyze_stream
from .database import init_db
from .history import save_analysis, get_history, get_analysis_by_id, delete_analysis
from .webhooks import router as webhook_router
from .logger import log
from .industry import (
    detect_industry,
    classify_tools,
    migration_suggestions,
    detect_integrations,
    detect_tools,
    suggest_automations,
    INDUSTRY_LABELS,
    INDUSTRY_TOOLS,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    log.info("Mila backend v2.2 started — routes at /api")
    yield
    log.info("Mila backend stopped")


app = FastAPI(
    title="Mila Backend",
    description=(
        "## Mila — Business Analysis API v2.2\n\n"
        "Alle Routen unter `/api` — kompatibel mit Replit-Proxy.\n\n"
        "### Analyse-Modi\n"
        "- **`/api/analyze`** — Regelbasiert, sofort\n"
        "- **`/api/ai-analyze`** — Groq LLaMA 3.3 70B\n"
        "- **`/api/ai-analyze/stream`** — SSE-Streaming\n"
    ),
    version="2.2.0",
    lifespan=lifespan,
    root_path="",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhook_router, prefix="/api")


# ─── Industry detection ──────────────────────────────────────────────────────

class IndustryRequest(BaseModel):
    text: str
    tools: list[str] = []


@app.post(
    "/api/industry",
    tags=["Industry"],
    summary="Live-Branchenerkennung",
    description=(
        "Analysiert einen Freitext und eine Tool-Liste und gibt sofort zurück:\n\n"
        "- Erkannte Branche + Label\n"
        "- Tool-Klassifikation (alt / modern / unbekannt)\n"
        "- Migrations-Hinweise pro Legacy-Tool\n"
        "- Typische Integrationen der Branche\n"
        "- Empfohlene moderne Tools falls noch keine vorhanden"
    ),
)
def industry_detect(req: IndustryRequest):
    log.info("POST /api/industry — corpus len=%d tools=%s", len(req.text), req.tools)
    detected = detect_industry(req.text)
    label = INDUSTRY_LABELS.get(detected, detected.title()) if detected else None

    # Also scan for tool names embedded in the free text
    text_tools = detect_tools(req.text)
    all_tools = list({t.lower() for t in req.tools + text_tools})

    classified = classify_tools(all_tools, detected)
    migrations = migration_suggestions(classified["old"])
    integrations = detect_integrations(detected) if detected else []
    automations = suggest_automations(detected, classified["old"])

    # Suggest modern tools for the detected industry if the user has none yet
    modern_suggestions: list[str] = []
    if detected and not classified["modern"] and detected in INDUSTRY_TOOLS:
        modern_suggestions = INDUSTRY_TOOLS[detected]["modern"][:4]

    return {
        "detected_industry": detected,
        "industry_label": label,
        "tools_old": classified["old"],
        "tools_modern": classified["modern"],
        "tools_unknown": classified["unknown"],
        "migration_hints": migrations,
        "integrations": integrations,
        "modern_suggestions": modern_suggestions,
        "automation_suggestions": automations,
    }


# ─── System ──────────────────────────────────────────────────────────────────

@app.get("/api", tags=["System"])
@app.get("/api/", tags=["System"])
def root():
    return {
        "status": "running",
        "version": "2.2.0",
        "endpoints": {
            "rule_analysis":   "POST /api/analyze",
            "ai_analysis":     "POST /api/ai-analyze",
            "ai_stream":       "POST /api/ai-analyze/stream",
            "history_list":    "GET  /api/history",
            "history_detail":  "GET  /api/history/{id}",
            "stripe_webhook":  "POST /api/webhook/stripe",
            "premium_webhook": "POST /api/webhook/premium",
            "webhook_events":  "GET  /api/webhook/events",
            "docs":            "/api/docs",
        },
    }


@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "version": "2.2.0"}


# ─── Rule-based analysis ─────────────────────────────────────────────────────

@app.post(
    "/api/analyze",
    response_model=AnalysisResult,
    tags=["Analysis"],
    summary="Regelbasierte Analyse",
    description=(
        "Schnelle, deterministische Analyse — keine LLM-Kosten.\n\n"
        "**Beispiel:**\n"
        "```json\n"
        "{\n"
        "  \"business_name\": \"Acme Co\",\n"
        "  \"industry\": \"SaaS\",\n"
        "  \"team_size\": 3,\n"
        "  \"tools\": [\"Slack\", \"Notion\", \"Zapier\"],\n"
        "  \"repeated_tasks\": \"Wöchentliche Reports\",\n"
        "  \"time_wasters\": \"Manuelles Datenkopieren\",\n"
        "  \"top_priority\": \"Schneller liefern\",\n"
        "  \"premium_active\": true,\n"
        "  \"user_yes_for_automation\": true\n"
        "}\n"
        "```"
    ),
)
def analyze(profile: BusinessProfile):
    log.info("POST /api/analyze — %s", profile.business_name)
    result = analyze_business(profile)
    _save(profile, result, "rule")
    return result


# ─── AI analysis (blocking) ──────────────────────────────────────────────────

@app.post(
    "/api/ai-analyze",
    response_model=AnalysisResult,
    tags=["Analysis"],
    summary="KI-Analyse (blockend)",
    description="KI-Analyse via Groq LLaMA 3.3 70B. Identisches Schema wie `/api/analyze`.",
)
def ai_analyze(profile: BusinessProfile):
    log.info("POST /api/ai-analyze — %s", profile.business_name)
    try:
        result = ai_analyze_business(profile)
    except Exception as e:
        log.error("AI analyze error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    _save(profile, result, "ai")
    return result


# ─── AI analysis (SSE streaming) ─────────────────────────────────────────────

@app.post(
    "/api/ai-analyze/stream",
    tags=["Analysis"],
    summary="KI-Analyse (SSE-Stream)",
    description=(
        "Token-für-Token SSE-Stream.\n\n"
        "**Chunk:** `data: {\"token\": \"...\"}`\n\n"
        "**Ende:** `data: {\"done\": true, \"automation_allowed\": bool}`"
    ),
    response_class=StreamingResponse,
)
def ai_stream(profile: BusinessProfile):
    log.info("POST /api/ai-analyze/stream — %s", profile.business_name)
    try:
        return StreamingResponse(
            ai_analyze_stream(profile),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except Exception as e:
        log.error("Stream error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ─── History ─────────────────────────────────────────────────────────────────

@app.get("/api/history", tags=["History"], summary="Analyse-History")
def list_history(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    return {"items": get_history(limit=limit, offset=offset), "limit": limit, "offset": offset}


@app.get("/api/history/{record_id}", tags=["History"], summary="Einzelne Analyse")
def get_history_item(record_id: int):
    item = get_analysis_by_id(record_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Analyse #{record_id} nicht gefunden.")
    return item


@app.delete("/api/history/{record_id}", tags=["History"], summary="Analyse löschen")
def delete_history_item(record_id: int):
    if not delete_analysis(record_id):
        raise HTTPException(status_code=404, detail=f"Analyse #{record_id} nicht gefunden.")
    return {"deleted": True, "id": record_id}


# ─── Internal ────────────────────────────────────────────────────────────────

def _save(profile: BusinessProfile, result: dict, source: str) -> None:
    try:
        save_analysis(
            business_name=profile.business_name,
            industry=profile.industry,
            source=source,
            input_data=profile.model_dump(),
            output_data=result,
        )
    except Exception as e:
        log.warning("History save failed: %s", e)
