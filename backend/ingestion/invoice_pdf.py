"""Extract the sole recognized invoice attachment and inspect rendered pages."""

import csv
from io import StringIO
import json
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import re
import subprocess
import sys

import fitz

from .invoice import InvoiceInputError, project_invoice, read_limited

INVOICE_ATTACHMENTS = {"factur-x.xml", "zugferd-invoice.xml", "zugferd.xml"}
LABEL = re.compile(r"\b(?:zahlbetrag|amount due)\b", re.IGNORECASE)
AMOUNT = re.compile(r"^\s*(\d{1,3}(?:[. ]\d{3})*,\d{2}|\d+[.,]\d{2})\s*(?:€|EUR)?\s*$")


def visible_amount(tsv, page):
    words = [
        (row["text"], int(row["left"]), int(row["top"]), int(row["width"]), int(row["height"]))
        for row in csv.DictReader(StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE)
        if row.get("text") and row["level"] == "5"
    ]
    amounts = [(word, AMOUNT.fullmatch(word[0])) for word in words]
    rows = []
    labels = [(text, x, y, width, height) for text, x, y, width, height in words
              if LABEL.fullmatch(text.rstrip(":")) or text.lower() == "due"]
    for _, x, y, width, height in labels:
        matches = [match[1] for (_, left, top, _, h), match in amounts
                   if match and left >= x + width
                   and abs((top + h / 2) - (y + height / 2)) <= max(h, height) * 0.45]
        if not matches:
            rows.append({"page": page, "amount": None})
        for value in matches:
            if "," in value:
                value = value.replace(".", "").replace(" ", "").replace(",", ".")
            rows.append({"page": page, "amount": value})
    return rows


def inspect(pdf):
    with fitz.open(stream=pdf, filetype="pdf") as document:
        if document.needs_pass or not 1 <= len(document) <= 12:
            raise InvoiceInputError("Encrypted or oversized PDF page set")
        names = [name for name in document.embfile_names() if name.lower() in INVOICE_ATTACHMENTS]
        if len(names) != 1:
            raise InvoiceInputError("Exactly one recognized embedded invoice XML is required")
        if document.embfile_info(names[0])["size"] > 8 * 1024 * 1024:
            raise InvoiceInputError("Embedded XML exceeds the size limit")
        xml = document.embfile_get(names[0])
        source = project_invoice(xml)
        if source["syntax"] != "CII":
            raise InvoiceInputError("Embedded invoice must be CII")
        values = source["fields"]["BT-115"]["values"]
        expected = values[0]["original"] if source["fields"]["BT-115"]["status"] == "observed" else None
        evidence = []
        for number, page in enumerate(document, start=1):
            width, height = page.rect.width, page.rect.height
            if not 1 <= width <= 900 or not 1 <= height <= 1250:
                raise InvoiceInputError("Page dimensions exceed the supported render bounds")
            image = page.get_pixmap(dpi=350, alpha=False).tobytes("png")
            completed = subprocess.run(
                ["tesseract", "stdin", "stdout", "-l", "eng", "--psm", "11", "tsv"],
                input=image, capture_output=True, check=True, timeout=15,
            )
            evidence.extend(visible_amount(completed.stdout.decode("utf-8"), number))
        if expected is None or len(evidence) != 1 or evidence[0]["amount"] is None:
            result = "NOT_COMPARABLE"
        elif Decimal(evidence[0]["amount"]) != Decimal(expected):
            result = "DIFFERENT"
        else:
            result = "NEEDS_VISUAL_CONFIRMATION"
        return xml, {
            "pdfSha256": sha256(pdf).hexdigest(),
            "method": "whole-page-rendered-ocr",
            "pages": len(document),
            "status": result,
            "xmlPayable": expected,
            "candidates": evidence,
        }


if __name__ == "__main__":
    try:
        data = read_limited(Path(sys.argv[1]), 8 * 1024 * 1024)
        xml, evidence = inspect(data)
        with Path(sys.argv[2]).open("xb") as output:
            output.write(xml)
        print(json.dumps(evidence))
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print(json.dumps({"error": str(exc)}))
        raise SystemExit(1)
