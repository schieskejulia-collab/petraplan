"""Reproduce one pinned historical PDF/XML discrepancy; no general rounding waiver."""
import argparse
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
from xml.etree import ElementTree as ET

import fitz

ROOT = Path(__file__).resolve().parents[2]
PDF_SHA = "98a694e3eaca6c7e37a85cba73a640977c121c01549e09182836b433d8d53a18"
XML_SHA = "05adb685ec43b1e4c57f97b8b4b73df72cf54e1d7ed77487818e28c97361b986"
UPSTREAM_COMMIT = "f9678ecef593a970b76cf0622b64825a45f17b8d"
RAM = "{urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100}"
NS = {"rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
      "ram": RAM[1:-1]}
SETTLEMENT = "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement"
TOTAL = SETTLEMENT + "/ram:SpecifiedTradeSettlementHeaderMonetarySummation"


def money(value):
    return Decimal(value.replace(".", "").replace(",", "."))


def rounded(value):
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def investigate(file, jar, scenarios):
    pdf = file.read_bytes()
    if sha256(pdf).hexdigest() != PDF_SHA:
        raise ValueError("This evidence probe only accepts the pinned historical PDF")
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        attachments = [n for n in doc.embfile_names() if n.lower().endswith(".xml")]
        if len(doc) != 1 or attachments != ["factur-x.xml"]:
            raise ValueError("Historical PDF attachment/page identity changed")
        xml = doc.embfile_get(attachments[0])
        text = doc[0].get_text()
        words = doc[0].get_text("words")
    if sha256(xml).hexdigest() != XML_SHA:
        raise ValueError("Historical XML no longer matches the original evidence")
    root = ET.fromstring(xml)

    def pdf_value(pattern):
        values = re.findall(pattern, text)
        if len(values) != 1:
            raise ValueError("PDF field is missing or ambiguous: " + pattern)
        return money(values[0])

    def xml_value(name):
        nodes = root.findall(TOTAL + "/ram:" + name, NS)
        if len(nodes) != 1:
            raise ValueError("XML monetary field is missing or ambiguous: " + name)
        return Decimal(nodes[0].text)

    pdf_fields = {
        "positionsNet": pdf_value(r"Positionen\s+netto\s+([\d.,]+)\s*€"),
        "shippingNet": pdf_value(r"Versandkosten\s+netto\s+([\d.,]+)\s*€"),
        "positionsVat": pdf_value(r"Positionen\s+USt\.\s+19,00%\s+auf\s+804,35\s*€\s+([\d.,]+)\s*€"),
        "shippingVat": pdf_value(r"Versandkosten\s+USt\.\s+19,00%\s+auf\s+4,99\s*€\s+([\d.,]+)\s*€"),
        "grand": pdf_value(r"Endsumme\s+([\d.,]+)\s*€"),
    }
    names = ["LineTotalAmount", "ChargeTotalAmount", "AllowanceTotalAmount", "TaxBasisTotalAmount",
             "TaxTotalAmount", "GrandTotalAmount", "TotalPrepaidAmount", "DuePayableAmount"]
    xml_fields = {n: xml_value(n) for n in names}
    taxes = root.findall(SETTLEMENT + "/ram:ApplicableTradeTax", NS)
    if len(taxes) != 1:
        raise ValueError("Expected exactly one historical header VAT group")
    rate = Decimal(taxes[0].findtext("ram:RateApplicablePercent", namespaces=NS)) / 100
    basis = Decimal(taxes[0].findtext("ram:BasisAmount", namespaces=NS))
    tax = Decimal(taxes[0].findtext("ram:CalculatedAmount", namespaces=NS))
    assert rate == Decimal("0.19")
    assert pdf_fields["positionsNet"] == xml_fields["LineTotalAmount"] == Decimal("804.35")
    assert pdf_fields["shippingNet"] == xml_fields["ChargeTotalAmount"] == Decimal("4.99")
    assert rounded(pdf_fields["positionsNet"] * rate) == pdf_fields["positionsVat"] == Decimal("152.83")
    assert rounded(pdf_fields["shippingNet"] * rate) == pdf_fields["shippingVat"] == Decimal("0.95")
    split_tax = pdf_fields["positionsVat"] + pdf_fields["shippingVat"]
    assert basis == xml_fields["TaxBasisTotalAmount"] == Decimal("809.34")
    assert rounded(basis * rate) == tax == xml_fields["TaxTotalAmount"] == Decimal("153.77")
    assert basis + split_tax == pdf_fields["grand"] == Decimal("963.12")
    assert basis + tax == xml_fields["GrandTotalAmount"] == xml_fields["DuePayableAmount"] == Decimal("963.11")
    assert xml_fields["AllowanceTotalAmount"] == xml_fields["TotalPrepaidAmount"] == 0
    assert not root.findall(".//" + RAM + "RoundingAmount")
    terms = root.findtext(SETTLEMENT + "/ram:SpecifiedTradePaymentTerms/ram:Description", namespaces=NS)
    assert terms == "Innerhalb von 30 Tagen 2% Skonto, 60 Tage ohne Abzug"
    assert terms in re.sub(r"\s+", " ", text)
    assert rounded(Decimal("963.11") * Decimal("0.02")) != Decimal("0.01")

    # Execute the unchanged product PDF+XML integration, not the XML path alone.
    javascript = """import { inspectInvoiceFile } from './scripts/capture-invoice-case.mjs';
const [file,jar,scenarios]=process.argv.slice(1);
const artifact=await inspectInvoiceFile(file,{jar,scenarios});
console.log(JSON.stringify(artifact.result));"""
    result = subprocess.run(["node", "--input-type=module", "-e", javascript,
                             str(file.resolve()), str(jar.resolve()), str(scenarios.resolve())],
                            cwd=ROOT, check=True, capture_output=True, text=True, timeout=180)
    product = json.loads(result.stdout)
    assert product["technicalEvidence"]["accepted"] is True
    assert product["technicalEvidence"]["validatorDecision"] == "accept"
    assert product["pdfComparison"]["status"] == "NOT_COMPARABLE"
    assert product["pdfComparison"]["candidates"] == []
    assert product["decision"]["status"] == "BLOCKED"
    assert product["decision"]["releaseAllowed"] is False
    assert product["decision"]["blockers"] == ["PDF_VISUAL_AMOUNT_CONFLICT"]
    assert sha256(file.read_bytes()).hexdigest() == PDF_SHA

    return {
        "scope": "one-pinned-historical-weclapp-example-no-general-tolerance",
        "source": {"repository": "ZUGFeRD/mustangproject", "commit": UPSTREAM_COMMIT,
                   "path": "library/src/test/resources/MustangBeispiel20221026.pdf",
                   "pdfSha256": PDF_SHA, "xmlSha256": XML_SHA},
        "pdf": {"page": 1, "fields": {k: str(v) for k, v in pdf_fields.items()},
                "amountWordAnchors": [{"text": w[4], "box": list(w[:4])} for w in words
                                      if w[4] in {"804,35", "4,99", "152,83", "0,95", "963,12", "963,12€"}],
                "separatePayableLabelFound": False},
        "xml": {"fields": {k: {"value": str(v), "path": TOTAL + "/ram:" + k}
                            for k, v in xml_fields.items()}, "vatBasis": str(basis),
                "vatRate": str(rate), "vatCalculated": str(tax), "roundingAmountPresent": False,
                "paymentTerms": terms},
        "arithmetic": {"rounding": "Decimal ROUND_HALF_UP to 0.01 reproduces the displayed amounts",
                       "pdfSplitVat": str(split_tax), "xmlGroupedVat": str(tax),
                       "difference": str(pdf_fields["grand"] - xml_fields["GrandTotalAmount"]),
                       "skontoAppliedToExplainDifference": False},
        "product": {k: product[k] for k in ["contract", "syntax", "sourceSha256", "technicalEvidence", "decision", "pdfComparison"]}
                   | {"fields": {k: product["fields"][k] for k in ["BT-109", "BT-110", "BT-112", "BT-115"]}},
        "conclusion": "Displayed discrepancy reproduced by different VAT rounding groupings; original software internals and business/legal approval are not proven",
        "released": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--kosit-jar", type=Path, required=True)
    parser.add_argument("--scenarios", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    evidence = investigate(args.file, args.kosit_jar, args.scenarios)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2) + "\n")
    print("Pinned weclapp discrepancy reproduced: split VAT 153.78 vs grouped VAT 153.77; product remains BLOCKED, no rounding waiver.")
