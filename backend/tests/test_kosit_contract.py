import base64
from copy import deepcopy
import gzip
from hashlib import sha256
import json
from pathlib import Path
import unittest
from xml.etree import ElementTree as ET

from backend.ingestion.invoice import NS, InvoiceInputError, read_kosit_report, decide, project_invoice
from backend.ingestion.kosit_contract import EN, XR, PROFILES

FIXTURES = Path(__file__).parent / "fixtures" / "kosit"


def fixture(name="0114-ubl.xml.kosit.xml.gz"):
    report = ET.fromstring(gzip.decompress((FIXTURES / name).read_bytes()))
    configuration = ET.fromstring(gzip.decompress((FIXTURES / "scenarios.xml.gz").read_bytes()))
    digest = base64.b64decode(report.findtext(
        "rep:documentIdentification/rep:documentHash/rep:hashValue", namespaces=NS)).hex()
    return report, configuration, digest


class KositScenarioContractTest(unittest.TestCase):
    def check_report(self, report, config, digest, syntax="UBL", profile=XR):
        return read_kosit_report(ET.tostring(report), digest, syntax=syntax,
                                 profile=profile, configuration=config)

    def test_eight_unchanged_original_reports_have_their_complete_scenario_basis(self):
        manifest = json.loads((FIXTURES / "manifest.json").read_text())
        self.assertEqual(sha256(gzip.decompress((FIXTURES / "scenarios.xml.gz").read_bytes())).hexdigest(),
                         manifest["configurationSha256"])
        for item in manifest["reports"]:
            with self.subTest(file=item["file"]):
                raw = gzip.decompress((FIXTURES / item["file"]).read_bytes())
                self.assertEqual(sha256(raw).hexdigest(), item["originalSha256"])
                report, config, digest = fixture(item["file"])
                general = item["file"].startswith(("cen-", "facturx-"))
                syntax = "UBL" if "-ubl." in item["file"] else "CII"
                result = self.check_report(report, config, digest, syntax, EN if general else XR)
                self.assertTrue(result["accepted"])
                self.assertEqual(result["validatorDecision"], "accept")
                self.assertEqual(len(result["reportContract"]["requiredSteps"]), 3 if general else 4)

    def test_each_missing_required_step_blocks_in_both_scenario_families(self):
        for name, syntax, profile in [("0114-ubl.xml.kosit.xml.gz", "UBL", XR),
                                       ("cen-huf-cii.xml.kosit.xml.gz", "CII", EN)]:
            for step in ["val-xml", "val-xsd", "val-sch.1"] + (["val-sch.2"] if profile == XR else []):
                with self.subTest(name=name, step=step):
                    report, config, digest = fixture(name)
                    matched = report.find("rep:scenarioMatched", NS)
                    matched.remove(matched.find(f"rep:validationStepResult[@id='{step}']", NS))
                    result = self.check_report(report, config, digest, syntax, profile)
                    self.assertFalse(result["accepted"])
                    self.assertEqual(result["validatorDecision"], "accept")
                    self.assertIn(step, result["reportContract"]["missingSteps"])

    def test_duplicate_unexpected_or_failed_step_cannot_be_hidden(self):
        for change in ("duplicate", "unexpected", "failed", "missing-result", "wrong-resource"):
            with self.subTest(change=change):
                report, config, digest = fixture()
                matched = report.find("rep:scenarioMatched", NS)
                step = matched.find("rep:validationStepResult[@id='val-sch.2']", NS)
                if change == "duplicate": matched.append(deepcopy(step))
                elif change == "unexpected": step.set("id", "unrecognized")
                elif change == "failed": step.set("valid", "false")
                elif change == "missing-result": del step.attrib["valid"]
                else: step.find("s:resource/s:location", NS).text = "different-rule.xsl"
                self.assertFalse(self.check_report(report, config, digest)["accepted"])

    def test_scenario_cannot_be_swapped_or_changed_by_a_report(self):
        for change in ("renamed", "changed-match", "removed-rule", "multiple", "none"):
            with self.subTest(change=change):
                report, config, digest = fixture()
                matched = report.find("rep:scenarioMatched", NS)
                scenario = matched.find("s:scenario", NS)
                if change == "renamed": scenario.find("s:name", NS).text = "EN16931 (UBL Invoice)"
                elif change == "changed-match": scenario.find("s:match", NS).text = "true()"
                elif change == "removed-rule": scenario.remove(scenario.findall("s:validateWithSchematron", NS)[1])
                elif change == "multiple": report.append(deepcopy(matched))
                else: report.remove(matched)
                self.assertFalse(self.check_report(report, config, digest)["accepted"])

    def test_source_profile_syntax_and_trusted_configuration_are_required(self):
        report, config, digest = fixture()
        for syntax, profile, configuration in [("CII", XR, config), ("UBL", EN, config),
                                                ("UBL", "unknown", config), ("UBL", XR, None)]:
            with self.subTest(syntax=syntax, profile=profile, configuration=configuration is not None):
                self.assertFalse(self.check_report(report, configuration, digest, syntax, profile)["accepted"])
        scenario = next(s for s in config.findall("s:scenario", NS)
                        if s.findtext("s:name", namespaces=NS) == "EN16931 XRechnung (UBL Invoice)")
        config.append(deepcopy(scenario))
        self.assertFalse(self.check_report(report, config, digest)["accepted"])

    def test_all_enabled_invoice_profiles_have_an_explicit_step_contract(self):
        # Constructed reports test the reader policy, not actual CVD/Extension invoice conformity.
        original, config, digest = fixture()
        for syntax in ("UBL", "CII"):
            for profile, family in PROFILES.items():
                with self.subTest(syntax=syntax, profile=profile):
                    report = deepcopy(original)
                    matched = report.find("rep:scenarioMatched", NS)
                    matched.clear()
                    name = f"{family} ({'UBL Invoice' if syntax == 'UBL' else 'CII'})"
                    scenario = next(s for s in config.findall("s:scenario", NS)
                                    if s.findtext("s:name", namespaces=NS) == name)
                    matched.append(deepcopy(scenario))
                    ET.SubElement(matched, f"{{{NS['rep']}}}validationStepResult", id="val-xml", valid="true")
                    definitions = scenario.findall("s:validateWithXmlSchema", NS) + scenario.findall("s:validateWithSchematron", NS)
                    for i, definition in enumerate(definitions):
                        step = ET.SubElement(matched, f"{{{NS['rep']}}}validationStepResult",
                                             id="val-xsd" if i == 0 else f"val-sch.{i}", valid="true")
                        step.append(deepcopy(definition.find("s:resource", NS)))
                    self.assertTrue(self.check_report(report, config, digest, syntax, profile)["accepted"])

    def test_rejection_error_unknown_level_and_wrong_hash_remain_closed(self):
        for change in ("reject", "invalid-report", "error", "unknown-level", "wrong-hash"):
            with self.subTest(change=change):
                report, config, digest = fixture()
                if change == "reject": report.find("rep:assessment/rep:accept", NS).tag = f"{{{NS['rep']}}}reject"
                elif change == "invalid-report": report.set("valid", "false")
                elif change in {"error", "unknown-level"}:
                    step = report.find("rep:scenarioMatched/rep:validationStepResult", NS)
                    ET.SubElement(step, f"{{{NS['rep']}}}message", level="error" if change == "error" else "unknown", code="PROBE")
                else:
                    with self.assertRaisesRegex(InvoiceInputError, "does not match"):
                        self.check_report(report, config, "0" * 64)
                    continue
                self.assertFalse(self.check_report(report, config, digest)["accepted"])

    def test_blocker_preserves_validator_rejection_versus_own_contract_failure(self):
        source = project_invoice(b'<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>')
        for evidence, expected in [
            ({"accepted": False, "validatorDecision": "reject"}, "KOSIT_REJECTED"),
            ({"accepted": False, "validatorDecision": "accept", "reportContract": {"status": "STEP_SET_MISMATCH"}}, "KOSIT_REPORT_CONTRACT_MISMATCH"),
            ({"accepted": False, "validatorDecision": "accept", "executionFailed": True}, "KOSIT_EXECUTION_FAILED"),
        ]:
            evidence["invoiceSha256"] = source["sourceSha256"]
            decision = decide(source, evidence)
            self.assertIn(expected, decision["blockers"])
            self.assertFalse(decision["releaseAllowed"])
