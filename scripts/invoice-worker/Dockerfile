FROM node:24-trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-21-jre-headless python3 python3-venv tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/invoice-python \
    && /opt/invoice-python/bin/pip install --no-cache-dir --only-binary=:all: PyMuPDF==1.26.6

ENV PATH="/opt/invoice-python/bin:${PATH}" \
    PETRAPLAN_KOSIT_JAR=/opt/kosit/validator.jar \
    PETRAPLAN_KOSIT_SCENARIOS=/opt/kosit/config/scenarios.xml \
    PORT=8080 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY backend/ingestion/invoice.py backend/ingestion/invoice_pdf.py backend/ingestion/kosit_contract.py backend/ingestion/invoice_duplicate_signals.py backend/ingestion/
COPY scripts/capture-invoice-case.mjs scripts/
COPY scripts/invoice-worker/protocol.mjs scripts/invoice-worker/server.mjs scripts/invoice-worker/

USER node
EXPOSE 8080
CMD ["node", "scripts/invoice-worker/server.mjs"]
