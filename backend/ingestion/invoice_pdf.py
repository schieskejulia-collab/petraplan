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
LABELS = (("zahlbetrag",), ("amount", "due"), ("net", "a", "payer"), ("net", "à", "payer"))
AMOUNT = re.compile(r"^\s*([+-]?(?:\d{1,3}(?:[. ]\d{3})*,\d{2}|\d+\.\d{2}))\s*(?:€|EUR)?\s*$")


def visible_amount(tsv, page):
    words = [
        (row["text"], int(row["left"]), int(row["top"]), int(row["width"]), int(row["height"]))
        for row in csv.DictReader(StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE)
        if row.get("text") and row["level"] == "5"
    ]
    # Sparse OCR splits both labels and amounts into separate TSV words/blocks.
    # Group geometrically; never treat a standalone "due" as a payable label.
    lines = []
    for word in sorted(words, key=lambda w: (w[2] + w[4] / 2, w[1])):
        for line in lines:
            anchor = line[0]
            if abs((word[2] + word[4] / 2) - (anchor[2] + anchor[4] / 2)) <= max(word[4], anchor[4]) * 0.45:
                line.append(word)
                break
        else:
            lines.append([word])
    evidence = []
    for line in lines:
        line.sort(key=lambda w: w[1])
        tokens = [word[0].casefold().rstrip(":") for word in line]
        labels = [(i, i + len(label)) for i in range(len(tokens)) for label in LABELS
                  if tuple(tokens[i:i + len(label)]) == label
                  and all(line[j + 1][1] - (line[j][1] + line[j][3]) <= max(line[j][4], line[j + 1][4]) * 3
                          for j in range(i, i + len(label) - 1))]
        for index, (_, end) in enumerate(labels):
            stop = labels[index + 1][0] if index + 1 < len(labels) else len(line)
            values = []
            while end < stop:
                match = None
                consumed = 1
                for length in range(min(4, stop - end), 0, -1):
                    candidate = AMOUNT.fullmatch(" ".join(w[0] for w in line[end:end + length]))
                    if candidate:
                        match, consumed = candidate, length
                        break
                if match:
                    value = match[1]
                    if "," in value:
                        value = value.replace(".", "").replace(" ", "").replace(",", ".")
                    values.append(value)
                end += consumed
            evidence.extend({"page": page, "amount": value} for value in values or [None])
    return evidence


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
