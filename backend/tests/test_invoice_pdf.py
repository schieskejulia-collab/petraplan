import csv
from io import StringIO
import unittest
import os
from pathlib import Path

from backend.ingestion.invoice_pdf import visible_amount, inspect


def tsv(lines):
    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=["level", "left", "top", "width", "height", "text"], delimiter="\t")
    writer.writeheader()
    for y, words in lines:
        for text, x, width in words:
            writer.writerow({"level": 5, "left": x, "top": y, "width": width, "height": 12, "text": text})
    return output.getvalue()


class InvoicePdfLabelTest(unittest.TestCase):
    def test_split_french_and_english_labels_keep_the_amount_on_the_same_line(self):
        for label in [("NET", "A", "PAYER"), ("NET", "À", "PAYER:"), ("Amount", "due"), ("Zahlbetrag",)]:
            with self.subTest(label=label):
                words = [(word, 10 + i * 35, 30) for i, word in enumerate(label)]
                self.assertEqual(visible_amount(tsv([(20, words + [("104,90", 160, 45), ("EUR", 210, 30)])]), 2),
                                 [{"page": 2, "amount": "104.90"}])

    def test_standalone_due_and_other_totals_are_not_payment_amounts(self):
        for words in [[("due", 10, 30), ("104,90", 100, 40)],
                      [("Bruttosumme", 10, 80), ("104,90", 100, 40)],
                      [("NET", 10, 30), ("A", 300, 20), ("PAYER", 330, 45), ("104,90", 400, 40)]]:
            self.assertEqual(visible_amount(tsv([(20, words)]), 1), [])

    def test_unreadable_missing_or_different_line_never_borrows_another_amount(self):
        self.assertEqual(visible_amount(tsv([(20, [("Zahlbetrag", 10, 70)]),
                                            (60, [("104,90", 160, 45)])]), 1), [{"page": 1, "amount": None}])
        self.assertEqual(visible_amount(tsv([(20, [("Zahlbetrag", 10, 70), ("1.234", 160, 45)])]), 1),
                         [{"page": 1, "amount": None}])

    def test_two_labels_or_two_amounts_stay_two_candidates(self):
        two_lines = tsv([(20, [("Zahlbetrag", 10, 70), ("104,90", 160, 45)]),
                         (60, [("NET", 10, 30), ("A", 45, 20), ("PAYER", 70, 40), ("105,90", 160, 45)])])
        self.assertEqual([x["amount"] for x in visible_amount(two_lines, 1)], ["104.90", "105.90"])
        self.assertEqual([x["amount"] for x in visible_amount(tsv([(20, [("Zahlbetrag", 10, 70),
                            ("104,90", 160, 45), ("105,90", 230, 45)])]), 1)], ["104.90", "105.90"])

    def test_split_thousands_and_sign_are_preserved_without_duplicate_candidates(self):
        for words, value in [([("1", 160, 8), ("234,56", 175, 45)], "1234.56"),
                              ([("-225.14", 160, 55)], "-225.14"),
                              ([("0,00", 160, 40)], "0.00")]:
            self.assertEqual(visible_amount(tsv([(20, [("Zahlbetrag", 10, 70), *words])]), 1),
                             [{"page": 1, "amount": value}])


@unittest.skipUnless(os.environ.get("PETRAPLAN_INVOICE_FIXTURES"), "Requires controlled PDF fixtures and Tesseract")
class InvoicePdfRenderedTest(unittest.TestCase):
    def test_rendered_matching_different_and_duplicate_amounts_preserve_the_same_xml(self):
        directory = Path(os.environ["PETRAPLAN_INVOICE_FIXTURES"])
        original = (directory / "01.01a-uncefact.xml").read_bytes()
        for filename, status, amounts in [("positive.pdf", "NEEDS_VISUAL_CONFIRMATION", ["336.90"]),
                                          ("different.pdf", "DIFFERENT", ["337.90"]),
                                          ("ambiguous.pdf", "NOT_COMPARABLE", ["336.90", "337.90"])]:
            with self.subTest(filename=filename):
                xml, comparison = inspect((directory / filename).read_bytes())
                self.assertEqual(xml, original)
                self.assertEqual(comparison["status"], status)
                self.assertEqual([item["amount"] for item in comparison["candidates"]], amounts)
