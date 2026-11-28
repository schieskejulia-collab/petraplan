from copy import deepcopy
from hashlib import sha256
import unittest

from backend.ingestion.invoice import project_invoice


def document(syntax="UBL", number="INV-001", amount="119.00", quantity="1", period="20261101", buyer="DE987654321"):
    if syntax == "UBL":
        return f'''<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
        xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
        xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
        <cbc:ID>{number}</cbc:ID><cbc:IssueDate>2026-11-28</cbc:IssueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
        <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
        <cac:InvoicePeriod><cbc:StartDate>{period[:4]}-{period[4:6]}-{period[6:]}</cbc:StartDate></cac:InvoicePeriod>
        <cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Supplier A</cbc:RegistrationName></cac:PartyLegalEntity>
         <cac:PartyTaxScheme><cbc:CompanyID>DE123456789</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
        <cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Buyer A</cbc:RegistrationName></cac:PartyLegalEntity>
         <cac:PartyTaxScheme><cbc:CompanyID>{buyer}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
        <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">{amount}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">{amount}</cbc:PayableAmount></cac:LegalMonetaryTotal>
        <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">{quantity}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
         <cac:Item><cbc:Name>Service A</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item></cac:InvoiceLine>
        </Invoice>'''.encode()
    return f'''<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
      xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
      xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
      <rsm:ExchangedDocument><ram:ID>{number}</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20261128</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
      <rsm:SupplyChainTradeTransaction><ram:IncludedSupplyChainTradeLineItem>
        <ram:SpecifiedTradeProduct><ram:Name>Service A</ram:Name></ram:SpecifiedTradeProduct>
        <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">{quantity}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
        <ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19.00</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>100</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
      </ram:IncludedSupplyChainTradeLineItem><ram:ApplicableHeaderTradeAgreement>
       <ram:SellerTradeParty><ram:Name>Supplier A</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE123456789</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
       <ram:BuyerTradeParty><ram:Name>Buyer A</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">{buyer}</ram:ID></ram:SpecifiedTaxRegistration></ram:BuyerTradeParty>
      </ram:ApplicableHeaderTradeAgreement><ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
       <ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">{period}</udt:DateTimeString></ram:StartDateTime></ram:BillingSpecifiedPeriod>
       <ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount><ram:GrandTotalAmount>{amount}</ram:GrandTotalAmount><ram:DuePayableAmount>{amount}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
      </ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>'''.encode()


class DuplicateSignalsTest(unittest.TestCase):
    def test_equivalent_ubl_and_cii_have_comparable_observed_content(self):
        ubl, cii = [project_invoice(document(s))["duplicateSignals"] for s in ("UBL", "CII")]
        self.assertEqual(ubl["contentDigest"], cii["contentDigest"])
        self.assertIsNotNone(ubl["contentDigest"])
        for s in (ubl, cii):
            self.assertEqual(s["amount"], "119")
            self.assertEqual(s["issueDate"], "2026-11-28")
            self.assertEqual(s["seller"]["identifiers"][0]["value"], "DE123456789")
            self.assertTrue(s["seller"]["identifiers"][0]["path"].startswith("/Q{"))
            self.assertEqual(s["authority"], "DOCUMENT_CLAIMS_ONLY")

    def test_different_number_keeps_content_but_changes_source_identity(self):
        a, b = [project_invoice(document(number=n))["duplicateSignals"] for n in ("0001", "1")]
        self.assertEqual(a["contentDigest"], b["contentDigest"])
        self.assertNotEqual(a["sourceSha256"], b["sourceSha256"])
        self.assertNotEqual(a["number"], b["number"])

    def test_changed_performance_and_quantity_do_not_collapse(self):
        a=project_invoice(document())["duplicateSignals"]
        for kw in ({"period":"20261001"},{"quantity":"2"}):
            with self.subTest(kw=kw):
                b=project_invoice(document(**kw))["duplicateSignals"]
                self.assertNotEqual(a["contentDigest"],b["contentDigest"])

    def test_other_buyer_preserves_content_but_not_party_identity(self):
        a=project_invoice(document())["duplicateSignals"]
        b=project_invoice(document(buyer="DE111111111"))["duplicateSignals"]
        self.assertEqual(a["contentDigest"],b["contentDigest"])
        self.assertNotEqual(a["buyer"]["identifiers"],b["buyer"]["identifiers"])

    def test_zero_and_large_amounts_are_exact_and_unsupported_numbers_unknown(self):
        for raw,expected in [("0.00","0"),("999999999999999999.123456","999999999999999999.123456"),("-0.00","0"),("1e2",None)]:
            with self.subTest(raw=raw):
                self.assertEqual(project_invoice(document(amount=raw))["duplicateSignals"]["amount"],expected)

    def test_missing_line_quantity_prevents_content_completeness(self):
        raw=document().replace(b'<cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>',b'')
        self.assertIsNone(project_invoice(raw)["duplicateSignals"]["contentDigest"])

    def test_source_hash_is_the_actual_original_not_a_business_key(self):
        raw=document();s=project_invoice(raw)["duplicateSignals"]
        self.assertEqual(s["sourceSha256"],sha256(raw).hexdigest())

    def test_duplicate_invoice_number_remains_unknown(self):
        raw=document().replace(b'<cbc:ID>INV-001</cbc:ID>',b'<cbc:ID>INV-001</cbc:ID><cbc:ID>INV-002</cbc:ID>',1)
        self.assertIsNone(project_invoice(raw)["duplicateSignals"]["number"])

