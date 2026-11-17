"""Evaluate the original R051 XPath on an invoice from its pinned test set."""

import hashlib
import json
from pathlib import Path
import sys

from lxml import etree


RULE_ID = "PEPPOL-EN16931-R051"
FIXTURE_PATH = "rules/unit-UBL-PEPPOL/PEPPOL-EN16931-R051.xml"
RULE_PATH = "rules/sch/PEPPOL-EN16931-UBL.sch"
FIXTURE_BLOB = "08e2db8d1ccfb326488ffca571e447d73dda73f9"
RULE_BLOB = "5b84ce3e40e275787a34b8f4fac193d40ae0840b"
TEST_NS = {"t": "http://difi.no/xsd/vefa/validator/1.0"}
SCH_NS = {"s": "http://purl.oclc.org/dsdl/schematron"}


def parse(data):
    return etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True))


def pinned_xml(path, expected_blob):
    data = path.read_bytes()
    blob = hashlib.sha1(b"blob %d\x00" % len(data) + data).hexdigest()
    if blob != expected_blob:
        raise ValueError(f"Unrecognized OpenPeppol source: {path.name}")
    return parse(data)


def extract_cases(source_dir):
    suite = pinned_xml(source_dir / FIXTURE_PATH, FIXTURE_BLOB)
    cases = suite.xpath("./t:test", namespaces=TEST_NS)
    result = {}
    for number in (1, 4):
        case = cases[number - 1]
        expected = case.xpath("./t:assert/*[text()=$rule]", namespaces=TEST_NS, rule=RULE_ID)
        if len(expected) != 1:
            raise ValueError("The upstream test must supply one expectation for R051")
        invoice = case.xpath("./*[local-name()='Invoice']")[0]
        result[number] = {
            "expected": etree.QName(expected[0]).localname,
            "xml": etree.tostring(invoice, encoding="unicode", with_tail=False),
        }
    return result


def evaluate(source_dir, invoice):
    schema = pinned_xml(source_dir / RULE_PATH, RULE_BLOB)
    namespaces = {ns.get("prefix"): ns.get("uri") for ns in schema.xpath("./s:ns", namespaces=SCH_NS)}
    assertion, = schema.xpath(".//s:assert[@id=$rule]", namespaces=SCH_NS, rule=RULE_ID)
    currency_expression, = schema.xpath(".//s:let[@name='documentCurrencyCode']/@value", namespaces=SCH_NS)
    currency_nodes = invoice.xpath(currency_expression, namespaces=namespaces)
    currency, = currency_nodes
    # R051's context is a union of relative element matches. Select those matches
    # throughout the document, then execute the original assertion on each node.
    context = " | ".join("//" + term.strip() for term in assertion.getparent().get("context").split("|"))
    matches = invoice.xpath(context, namespaces=namespaces)
    if not matches:
        raise ValueError("R051 has no matching elements in this invoice")
    failures = [
        {
            "path": node.getroottree().getpath(node),
            "value": node.text,
            "observed": node.get("currencyID"),
            "expected": currency.text,
        }
        for node in matches
        if not node.xpath(assertion.get("test"), namespaces=namespaces, documentCurrencyCode=currency_nodes)
    ]
    return {"rule": RULE_ID, "flag": assertion.get("flag"), "checked": len(matches), "failures": failures}


if __name__ == "__main__":
    command, directory = sys.argv[1:]
    source_dir = Path(directory)
    if command == "extract":
        result = extract_cases(source_dir)
    elif command == "evaluate":
        result = evaluate(source_dir, parse(sys.stdin.buffer.read()))
    else:
        raise ValueError(f"Unknown command: {command}")
    print(json.dumps(result))
