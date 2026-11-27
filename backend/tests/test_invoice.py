import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.ingestion.invoice import InvoiceInputError, inspect_invoice, project_invoice, read_kosit_report


class InvoiceProjectionTest(unittest.TestCase):
    def test_unsupported_roots_and_doctypes_stop_at_input(self):
        for data in (b"<order/>", b"<!DOCTYPE x [<!ENTITY y 'value'>]><x>&y;</x>"):
            with self.subTest(data=data), self.assertRaises(InvoiceInputError):
                project_invoice(data)

    def test_missing_evidence_and_duplicate_identity_block(self):
        data = b'''<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
            xmlns:b="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
            <b:ID>007</b:ID><b:ID>008</b:ID><b:Note> Keep original </b:Note></Invoice>'''
        result = inspect_invoice(data)
        self.assertEqual(result["fields"]["BT-1"]["status"], "ambiguous")
        values = result["fields"]["BT-1"]["values"]
        self.assertEqual([value["original"] for value in values], ["007", "008"])
        self.assertNotEqual(values[0]["path"], values[1]["path"])
        self.assertIn(" Keep original ", [v["original"] for v in result["observations"] if not v["mapped"]])
        self.assertIn("BT-1:ambiguous", result["decision"]["blockers"])
        self.assertIn("KOSIT_EVIDENCE_MISSING", result["decision"]["blockers"])
        self.assertFalse(result["decision"]["releaseAllowed"])


@unittest.skipUnless(all(os.environ.get(name) for name in (
    "PETRAPLAN_KOSIT_JAR", "PETRAPLAN_KOSIT_SCENARIOS", "PETRAPLAN_INVOICE_FIXTURES",
)), "Requires the external KoSIT test documents and validator")
class InvoiceKositTest(unittest.TestCase):
    def test_external_ubl_and_cii_and_rejected_invoice(self):
        jar = Path(os.environ["PETRAPLAN_KOSIT_JAR"])
        scenarios = Path(os.environ["PETRAPLAN_KOSIT_SCENARIOS"])
        fixtures = Path(os.environ["PETRAPLAN_INVOICE_FIXTURES"])
        for filename, syntax, invoice_id in (
            ("01.01a.xml", "UBL", "123456XX"),
            ("01.02a.xml", "UBL", "123456"),
            ("01.03a.xml", "UBL", "RR123456"),
            ("01.01a-uncefact.xml", "CII", "123456XX"),
        ):
            with self.subTest(filename=filename):
                data = (fixtures / filename).read_bytes()
                result = inspect_invoice(data, jar, scenarios)
                self.assertEqual(result["syntax"], syntax)
                self.assertEqual(result["fields"]["BT-1"]["values"][0]["original"], invoice_id)
                self.assertEqual(result["sourceSha256"], result["technicalEvidence"]["invoiceSha256"])
                self.assertEqual(result["decision"]["status"], "READY_FOR_REVIEW")
                self.assertFalse(result["decision"]["releaseAllowed"])
                if filename in ("01.01a.xml", "01.01a-uncefact.xml"):
                    self.assertEqual(result["fields"]["BT-2"]["values"][0]["isoDate"], "2016-04-04")

        with TemporaryDirectory() as work:
            report = Path(work) / "report.xml"
            original = (fixtures / "01.01a.xml").read_bytes()
            accepted = inspect_invoice(original, jar, scenarios, report)
            altered = original.replace(b"</cbc:PayableAmount>", b"1</cbc:PayableAmount>", 1)
            self.assertNotEqual(original, altered)
            with self.assertRaisesRegex(InvoiceInputError, "does not match"):
                read_kosit_report(report.read_bytes(), project_invoice(altered)["sourceSha256"])
            messages = accepted["technicalEvidence"]["messages"]
            self.assertTrue(any(m["code"] == "BR-DE-TMP-32" and m["level"] == "information" for m in messages))
            rejected = inspect_invoice(altered, jar, scenarios)
            self.assertEqual(rejected["decision"]["status"], "BLOCKED")
            self.assertIn("KOSIT_REJECTED", rejected["decision"]["blockers"])
            self.assertTrue(any(m["code"] == "BR-CO-16" for m in rejected["technicalEvidence"]["messages"]))
            self.assertFalse(rejected["decision"]["releaseAllowed"])
