"""Read UBL and CII invoices into an evidence-backed EN 16931 projection."""

import argparse
from base64 import b64decode
from collections import Counter
from datetime import date
from hashlib import sha256
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from xml.etree import ElementTree as ET

from .kosit_contract import assess_report_contract

NS = {
    "ubl": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    "rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
    "ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
    "udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
    "rep": "http://www.xoev.de/de/validator/varl/1",
    "s": "http://www.xoev.de/de/validator/framework/1/scenarios",
}
ROOTS = {
    f"{{{NS['ubl']}}}Invoice": "UBL",
    f"{{{NS['rsm']}}}CrossIndustryInvoice": "CII",
}

TRANSACTION = "rsm:SupplyChainTradeTransaction"
SETTLEMENT = f"{TRANSACTION}/ram:ApplicableHeaderTradeSettlement"
CII_TOTAL = f"{SETTLEMENT}/ram:SpecifiedTradeSettlementHeaderMonetarySummation"
UBL_TOTAL = "cac:LegalMonetaryTotal"
CII_LINE = f"{TRANSACTION}/ram:IncludedSupplyChainTradeLineItem"
UBL_LINE = "cac:InvoiceLine"
CONTRACT = "en16931-invoice-v1"

# These paths describe the supported invoice subset. An observation survives
# independently of whether it has a mapping in this contract version.
HEADER = {
    "BT-1": ("cbc:ID", "rsm:ExchangedDocument/ram:ID"),
    "BT-2": ("cbc:IssueDate", "rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString[@format='102']"),
    "BT-5": ("cbc:DocumentCurrencyCode", f"{SETTLEMENT}/ram:InvoiceCurrencyCode"),
    "BT-24": ("cbc:CustomizationID", "rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID"),
    "BT-27": ("cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName",
              f"{TRANSACTION}/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:Name"),
    "BT-59": ("cac:PayeeParty/cac:PartyName/cbc:Name", f"{SETTLEMENT}/ram:PayeeTradeParty/ram:Name"),
    "BT-84": ("cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID",
              f"{SETTLEMENT}/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/*"),
    "BT-109": (f"{UBL_TOTAL}/cbc:TaxExclusiveAmount", f"{CII_TOTAL}/ram:TaxBasisTotalAmount"),
    "BT-110": ("cac:TaxTotal/cbc:TaxAmount", f"{CII_TOTAL}/ram:TaxTotalAmount"),
    "BT-112": (f"{UBL_TOTAL}/cbc:TaxInclusiveAmount", f"{CII_TOTAL}/ram:GrandTotalAmount"),
    "BT-115": (f"{UBL_TOTAL}/cbc:PayableAmount", f"{CII_TOTAL}/ram:DuePayableAmount"),
    "BT-72": ("cac:Delivery/cbc:ActualDeliveryDate",
              f"{TRANSACTION}/ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent/"
              "ram:OccurrenceDateTime/udt:DateTimeString[@format='102']"),
}
LINE = {
    "BT-126": ("cbc:ID", "ram:AssociatedDocumentLineDocument/ram:LineID"),
    "BT-151": ("cac:Item/cac:ClassifiedTaxCategory/cbc:ID",
               "ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:TypeCode='VAT']/ram:CategoryCode"),
    "BT-152": ("cac:Item/cac:ClassifiedTaxCategory/cbc:Percent",
               "ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:TypeCode='VAT']/ram:RateApplicablePercent"),
}
REQUIRED = ("BT-1", "BT-2", "BT-5", "BT-24", "BT-27", "BT-109", "BT-110", "BT-112", "BT-115")
AMOUNTS = ("BT-109", "BT-110", "BT-112", "BT-115")
DATES = ("BT-2", "BT-72", "BT-73", "BT-74", "BT-134", "BT-135")


class InvoiceInputError(ValueError):
    pass


class BoundedXML(ET.TreeBuilder):
    def __init__(self):
        super().__init__()
        self.depth = 0

    def start(self, tag, attrs):
        self.depth += 1
        if self.depth > 96:
            raise InvoiceInputError("XML nesting limit exceeded")
        return super().start(tag, attrs)

    def end(self, tag):
        self.depth -= 1
        return super().end(tag)

    def doctype(self, name, public_id, system_id):
        raise InvoiceInputError("XML document type declarations are unsupported")


def parse_xml(data, limit):
    if len(data) > limit:
        raise InvoiceInputError("XML size limit exceeded")
    try:
        return ET.fromstring(data, parser=ET.XMLParser(target=BoundedXML()))
    except ET.ParseError as exc:
        raise InvoiceInputError("Malformed XML") from exc


def path_name(name):
    return f"Q{name}" if name.startswith("{") else name


def index_xml(root):
    paths = {}
    observations = {}

    def visit(node, path):
        paths[node] = path
        if node.text and (not len(node) or node.text.strip()):
            observations[path] = node.text
        for key, value in node.attrib.items():
            observations[f"{path}/@{path_name(key)}"] = value
        counts = Counter()
        for child in node:
            counts[child.tag] += 1
            visit(child, f"{path}/{path_name(child.tag)}[{counts[child.tag]}]")

    visit(root, f"/{path_name(root.tag)}[1]")
    return paths, observations


def project_invoice(data):
    root = parse_xml(data, 8 * 1024 * 1024)
    if root.tag not in ROOTS:
        raise InvoiceInputError("Unsupported invoice XML root")
    syntax = ROOTS[root.tag]
    ubl = syntax == "UBL"
    column = 0 if ubl else 1
    paths, observations = index_xml(root)
    mapped_paths = set()

    def read(nodes, term):
        values = []
        for node in nodes:
            path = paths[node]
            mapped_paths.add(path)
            value = {"path": path, "original": node.text}
            if term in DATES:
                raw = (node.text or "").strip()
                try:
                    normalized = date.fromisoformat(raw).isoformat()
                    if len(raw) == (10 if ubl else 8):
                        value["isoDate"] = normalized
                except ValueError:
                    pass
            if term in AMOUNTS:
                currency_path = f"{path}/@currencyID"
                mapping_currency = node.get("currencyID")
                if mapping_currency is not None:
                    mapped_paths.add(currency_path)
                value["currency"] = {
                    "value": mapping_currency if mapping_currency is not None else document_currency,
                    "path": currency_path if mapping_currency is not None else currency_path_in_header,
                    "basis": "attribute" if mapping_currency is not None else "document",
                }
            values.append(value)
        if not values:
            status = "missing"
        elif term != "BT-84" and len(values) > 1:
            status = "ambiguous"
        elif any(not value["original"] or not value["original"].strip() for value in values):
            status = "empty"
        elif term in DATES and any("isoDate" not in value for value in values):
            status = "invalid"
        else:
            status = "observed"
        return {"status": status, "values": values}

    currency_nodes = root.findall(HEADER["BT-5"][column], NS)
    document_currency = currency_nodes[0].text if len(currency_nodes) == 1 else None
    currency_path_in_header = paths[currency_nodes[0]] if len(currency_nodes) == 1 else None
    header = {}
    for term, alternatives in HEADER.items():
        nodes = root.findall(alternatives[column], NS)
        if term == "BT-110":
            # BT-111 can use the same element in a different currency.
            nodes = [node for node in nodes if document_currency
                     and node.get("currencyID") == document_currency]
        if term == "BT-84" and not ubl:
            nodes = [node for node in nodes if node.tag in (
                f"{{{NS['ram']}}}IBANID", f"{{{NS['ram']}}}ProprietaryID")]
        header[term] = read(nodes, term)

    def periods(node, path, start_term, end_term):
        start = "cbc:StartDate" if ubl else "ram:StartDateTime/udt:DateTimeString[@format='102']"
        end = "cbc:EndDate" if ubl else "ram:EndDateTime/udt:DateTimeString[@format='102']"
        return [{"path": paths[period], start_term: read(period.findall(start, NS), start_term),
                 end_term: read(period.findall(end, NS), end_term)} for period in node.findall(path, NS)]

    lines = []
    for node in root.findall(UBL_LINE if ubl else CII_LINE, NS):
        lines.append({
            "path": paths[node],
            "fields": {term: read(node.findall(path[column], NS), term) for term, path in LINE.items()},
            "BG-26": periods(node, "cac:InvoicePeriod" if ubl else
                             "ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod", "BT-134", "BT-135"),
        })
    document_periods = periods(root, "cac:InvoicePeriod" if ubl else
                               f"{SETTLEMENT}/ram:BillingSpecifiedPeriod", "BT-73", "BT-74")
    return {
        "contract": CONTRACT,
        "syntax": syntax,
        "sourceSha256": sha256(data).hexdigest(),
        "fields": header,
        "BG-14": document_periods,
        "lines": lines,
        "observations": [{"path": path, "original": value, "mapped": path in mapped_paths}
                         for path, value in observations.items()],
    }


def read_kosit_report(report, source_digest, *, syntax=None, profile=None, configuration=None):
    root = parse_xml(report, 32 * 1024 * 1024)
    if root.tag != f"{{{NS['rep']}}}report":
        raise InvoiceInputError("Unexpected KoSIT report root")
    hashes = root.findall("rep:documentIdentification/rep:documentHash", NS)
    if len(hashes) != 1:
        raise InvoiceInputError("KoSIT report must identify exactly one source hash")
    algorithm = hashes[0].findtext("rep:hashAlgorithm", namespaces=NS)
    value = hashes[0].findtext("rep:hashValue", default="", namespaces=NS)
    try:
        embedded_digest = b64decode(value, validate=True).hex()
    except ValueError as exc:
        raise InvoiceInputError("Invalid KoSIT source hash encoding") from exc
    if algorithm != "SHA-256" or embedded_digest != source_digest:
        raise InvoiceInputError("KoSIT report does not match the invoice SHA-256")
    assessments = root.findall("rep:assessment/*", NS)
    decision = assessments[0].tag if len(assessments) == 1 else None
    steps = root.findall("rep:scenarioMatched/rep:validationStepResult", NS)
    step_ids = [step.get("id") for step in steps]
    messages = [{"step": step.get("id"), "code": message.get("code"),
                 "level": message.get("level"), "path": message.get("xpathLocation"),
                 "text": (message.text or "").strip()}
                for step in steps for message in step.findall("rep:message", NS)]
    contract = assess_report_contract(root, syntax=syntax, profile=profile, configuration=configuration)
    accepted = (
        decision == f"{{{NS['rep']}}}accept" and root.get("valid") == "true"
        and contract["status"] == "MATCHED"
        and len(step_ids) == len(set(step_ids))
        and all(step.get("valid") == "true" for step in steps)
        and all(message["level"] in {"information", "warning"} for message in messages)
    )
    return {
        "invoiceSha256": source_digest,
        "reportSha256": sha256(report).hexdigest(),
        "engine": root.findtext("rep:engine/rep:name", namespaces=NS),
        "scenario": root.findtext("rep:scenarioMatched/s:scenario/s:name", namespaces=NS),
        "validatorDecision": decision.split("}")[-1] if decision else None,
        "accepted": accepted,
        "reportContract": contract,
        "steps": [{"id": step.get("id"), "valid": step.get("valid")} for step in steps],
        "messages": messages,
    }


def run_kosit(data, source_digest, jar, scenarios, output_report=None):
    jar, scenarios = jar.resolve(strict=True), scenarios.resolve(strict=True)
    # A configured installation supplies the validator and its local rule files.
    # Keep uploaded names and reports out of the validator invocation.
    with TemporaryDirectory(prefix="petraplan-invoice-") as directory:
        work = Path(directory)
        source = work / "invoice.xml"
        source.write_bytes(data)
        process = subprocess.run(
            ["java", "-jar", str(jar), "-s", str(scenarios),
             "-r", str(scenarios.parent), "-o", directory, str(source)],
            cwd=work, capture_output=True, timeout=90, check=False,
        )
        report = work / "invoice-report.xml"
        if not report.is_file():
            raise InvoiceInputError(f"KoSIT produced no report (exit {process.returncode})")
        raw_report = read_limited(report, 32 * 1024 * 1024)
    projection = project_invoice(data)
    profile = projection["fields"]["BT-24"]
    evidence = read_kosit_report(raw_report, source_digest, syntax=projection["syntax"],
                                 profile=profile["values"][0]["original"] if profile["status"] == "observed" else None,
                                 configuration=parse_xml(read_limited(scenarios, 2 * 1024 * 1024), 2 * 1024 * 1024))
    evidence["validatorJarSha256"] = sha256(jar.read_bytes()).hexdigest()
    evidence["scenariosSha256"] = sha256(scenarios.read_bytes()).hexdigest()
    resources = scenarios.parent / "resources"
    resource_manifest = [
        (file.relative_to(resources).as_posix(), sha256(file.read_bytes()).hexdigest())
        for file in sorted(resources.rglob("*")) if file.is_file()
    ]
    evidence["ruleResourcesSha256"] = sha256(
        json.dumps(resource_manifest, separators=(",", ":")).encode()
    ).hexdigest()
    # KoSIT returns a nonzero code for rejected documents. Unexpected engine
    # failures can never provide positive evidence.
    if process.returncode != 0:
        evidence["accepted"] = False
        if evidence["validatorDecision"] != "reject":
            evidence["executionFailed"] = True
    if output_report is not None:
        with output_report.open("xb") as stream:
            stream.write(raw_report)
    return evidence


def decide(projection, evidence):
    fields = projection["fields"]
    blockers = [f"{term}:{fields[term]['status']}" for term in REQUIRED
                if fields[term]["status"] != "observed"]
    for term in ("BT-59", "BT-72", "BT-84"):
        if fields[term]["status"] not in {"observed", "missing"}:
            blockers.append(f"{term}:{fields[term]['status']}")
    if not projection["lines"]:
        blockers.append("BG-25:missing")
    for line in projection["lines"]:
        for term, field in line["fields"].items():
            valid = {"observed", "missing"} if term == "BT-152" else {"observed"}
            if field["status"] not in valid:
                blockers.append(f"{line['path']} {term}:{field['status']}")
    for period in projection["BG-14"] + [p for line in projection["lines"] for p in line["BG-26"]]:
        for term, field in period.items():
            if term.startswith("BT-") and field["status"] not in {"observed", "missing"}:
                blockers.append(f"{period['path']} {term}:{field['status']}")
    if evidence is None or evidence["invoiceSha256"] != projection["sourceSha256"]:
        blockers.append("KOSIT_EVIDENCE_MISSING")
    elif not evidence["accepted"]:
        if evidence.get("validatorDecision") == "reject":
            blockers.append("KOSIT_REJECTED")
        elif evidence.get("executionFailed"):
            blockers.append("KOSIT_EXECUTION_FAILED")
        elif evidence.get("reportContract", {}).get("status") != "MATCHED":
            blockers.append("KOSIT_REPORT_CONTRACT_MISMATCH")
        else:
            blockers.append("KOSIT_REPORT_NOT_ACCEPTED")
    return {"status": "BLOCKED" if blockers else "READY_FOR_REVIEW",
            "releaseAllowed": False, "blockers": blockers}


def inspect_invoice(data, jar=None, scenarios=None, output_report=None):
    projection = project_invoice(data)
    evidence = None
    if (jar is None) != (scenarios is None):
        raise InvoiceInputError("Supply both the KoSIT jar and scenarios.xml")
    if jar is not None:
        evidence = run_kosit(data, projection["sourceSha256"], jar, scenarios, output_report)
    return {**projection, "technicalEvidence": evidence, "decision": decide(projection, evidence)}


def read_limited(path, limit):
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise InvoiceInputError("XML size limit exceeded")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("invoice", type=Path)
    parser.add_argument("--kosit-jar", type=Path)
    parser.add_argument("--scenarios", type=Path)
    parser.add_argument("--save-report", type=Path)
    args = parser.parse_args()
    try:
        result = inspect_invoice(read_limited(args.invoice, 8 * 1024 * 1024),
                                 args.kosit_jar, args.scenarios, args.save_report)
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        result = {"decision": {"status": "BLOCKED", "releaseAllowed": False, "blockers": [str(exc)]}}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return int(result["decision"]["status"] == "BLOCKED")


if __name__ == "__main__":
    raise SystemExit(main())
