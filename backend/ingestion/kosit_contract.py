"""Bind a KoSIT report to an explicitly supported, locally configured scenario.

The worker's administrator-controlled configuration is trusted. A scenario name
or a report-supplied list of successful steps is never sufficient on its own.
"""

from hashlib import sha256
import json

NS = {"rep": "http://www.xoev.de/de/validator/varl/1",
      "s": "http://www.xoev.de/de/validator/framework/1/scenarios"}
VERSION = "kosit-scenario-evidence-v2"
EN = "urn:cen.eu:en16931:2017"
XR = EN + "#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
PROFILES = {
    EN: "EN16931",
    XR: "EN16931 XRechnung",
    XR + "#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0": "EN16931 XRechnung Extension",
    XR + "#compliant#urn:xeinkauf.de:kosit:xrechnung:cvd_0.9": "EN16931 XRechnung CVD",
}


def signature(node):
    """Ignore serialization/formatting differences, retain definition content."""
    text = (node.text or "").strip()
    # XPath literals and resource locations must retain their internal spaces.
    if node.tag not in {f"{{{NS['s']}}}{name}" for name in ("match", "acceptMatch", "location", "namespace")}:
        text = " ".join(text.split())
    return [node.tag, sorted(node.attrib.items()), text,
            [signature(child) for child in node]]


def assess_report_contract(root, *, syntax=None, profile=None, configuration=None):
    result = {"version": VERSION, "status": "UNVERIFIED_CONFIGURATION", "requiredSteps": []}
    if configuration is None:
        return result
    family = PROFILES.get(profile)
    if syntax not in {"UBL", "CII"} or family is None:
        return {**result, "status": "UNSUPPORTED_SOURCE_PROFILE"}
    expected_name = f"{family} ({'UBL Invoice' if syntax == 'UBL' else 'CII'})"
    result["scenario"] = expected_name
    schema = ("resources/ubl/2.1/xsd/maindoc/UBL-Invoice-2.1.xsd" if syntax == "UBL"
              else "resources/cii/16b/xsd/CrossIndustryInvoice_100pD16B.xsd")
    schematron = [f"resources/{'ubl/2.1' if syntax == 'UBL' else 'cii/16b'}/xsl/EN16931-{syntax}-validation.xsl"]
    if profile != EN:
        schematron.append(f"resources/xrechnung/3.0.2/xsl/XRechnung-{syntax}-validation.xsl")
    expected_resources = {"val-xsd": schema, **{f"val-sch.{i}": path
                                              for i, path in enumerate(schematron, 1)}}
    required = ["val-xml", *expected_resources]
    result["requiredSteps"] = required
    if configuration.tag != f"{{{NS['s']}}}scenarios":
        return {**result, "status": "INVALID_CONFIGURATION"}
    configured = [s for s in configuration.findall("s:scenario", NS)
                  if s.findtext("s:name", namespaces=NS) == expected_name]
    matched = root.findall("rep:scenarioMatched", NS)
    if len(configured) != 1 or len(matched) != 1:
        return {**result, "status": "SCENARIO_MISSING_OR_AMBIGUOUS"}
    configured = configured[0]
    reported = matched[0].findall("s:scenario", NS)
    if len(reported) != 1 or signature(reported[0]) != signature(configured):
        return {**result, "status": "SCENARIO_DEFINITION_MISMATCH"}
    definitions = configured.findall("s:validateWithXmlSchema", NS)
    rules = configured.findall("s:validateWithSchematron", NS)
    locations = [d.findall("s:resource/s:location", NS) for d in [*definitions, *rules]]
    if (len(definitions) != 1 or len(rules) != len(schematron)
        or any(len(items) != 1 for items in locations)
        or [(items[0].text or "").strip() for items in locations] != [schema, *schematron]):
        return {**result, "status": "CONFIGURATION_REQUIREMENTS_MISMATCH"}
    # Record the exact configured scenario definition used for this decision.
    result["scenarioSha256"] = sha256(json.dumps(signature(configured),
                                                separators=(",", ":")).encode()).hexdigest()
    steps = matched[0].findall("rep:validationStepResult", NS)
    ids = [s.get("id") for s in steps]
    missing = sorted(set(required) - set(ids))
    unexpected = sorted(str(i) for i in set(ids) - set(required))
    if missing or unexpected or len(ids) != len(set(ids)):
        return {**result, "status": "STEP_SET_MISMATCH", "missingSteps": missing,
                "unexpectedSteps": unexpected, "duplicateSteps": len(ids) != len(set(ids))}
    resource_by_step = dict(zip(expected_resources, [d.find("s:resource", NS) for d in [*definitions, *rules]]))
    for step in steps:
        resources = step.findall("s:resource", NS)
        expected = resource_by_step.get(step.get("id"))
        if (step.get("valid") not in {"true", "false"}
            or (expected is None and resources)
            or (expected is not None and (len(resources) != 1 or signature(resources[0]) != signature(expected)))):
            return {**result, "status": "STEP_RESOURCE_OR_RESULT_MISMATCH"}
    return {**result, "status": "MATCHED"}
