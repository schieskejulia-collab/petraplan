"""Bounded, observed duplicate-comparison signals; never a duplicate verdict."""
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
import re

CONTRACT = "invoice-duplicate-signals-v1"


def decimal(value):
    if not isinstance(value, str) or not re.fullmatch(r"-?[0-9]{1,18}(?:\.[0-9]{1,6})?", value.strip()):
        return None
    try:
        number = Decimal(value.strip())
        return "0" if number == 0 else format(number.normalize(), "f")
    except InvalidOperation:
        return None


def signals(root, *, ubl, ns, paths, header, periods, source_hash):
    issues = set()

    def one(node, path, required=False, container=False):
        found = node.findall(path, ns)
        if len(found) != 1 or (not container and (not found[0].text or not found[0].text.strip())):
            if len(found) > 1 or required:
                issues.add("missing_or_ambiguous:" + path)
            return None
        return found[0]

    def text(node):
        return " ".join(node.text.split()) if node is not None and node.text else None

    def party(path):
        node = one(root, path, True, container=True)
        if node is None:
            return {"name": None, "identifiers": []}
        name = one(node, "cac:PartyLegalEntity/cbc:RegistrationName" if ubl else "ram:Name")
        name_value = text(name)
        if name_value and len(name_value) > 256:
            name_value = None
        ids = []
        if ubl:
            for registration in node.findall("cac:PartyTaxScheme", ns):
                scheme = one(registration, "cac:TaxScheme/cbc:ID")
                value = one(registration, "cbc:CompanyID")
                if text(scheme) == "VAT" and value is not None:
                    ids.append(("vat", value))
            legal = node.findall("cac:PartyLegalEntity/cbc:CompanyID", ns)
        else:
            ids += [("vat", n) for n in node.findall("ram:SpecifiedTaxRegistration/ram:ID", ns)
                    if n.get("schemeID") == "VA"]
            legal = node.findall("ram:SpecifiedLegalOrganization/ram:ID", ns)
        ids += [("legal:" + n.get("schemeID"), n) for n in legal
                if n.get("schemeID") and re.fullmatch(r"[A-Za-z0-9_-]{1,16}", n.get("schemeID"))]
        if len(ids) > 8:
            issues.add("too_many_party_identifiers")
            ids = []
        values = []
        for kind, value in ids:
            raw = text(value)
            normalized = re.sub(r"\s", "", raw).upper() if raw and kind == "vat" else raw
            if not normalized or len(normalized) > 128:
                continue
            if kind == "vat" and not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{2,30}", normalized):
                continue
            values.append({"kind": kind, "value": normalized, "path": paths[value]})
        return {"name": name_value, "identifiers": values}

    def observed(term):
        field = header.get(term, {})
        values = field.get("values", [])
        return values[0] if field.get("status") == "observed" and len(values) == 1 else None

    number, issued, payable = observed("BT-1"), observed("BT-2"), observed("BT-115")
    invoice_type = text(one(root, "cbc:InvoiceTypeCode" if ubl else "rsm:ExchangedDocument/ram:TypeCode", True))
    amount = decimal(payable.get("original")) if payable else None
    currency = payable.get("currency", {}).get("value") if payable else None
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        currency = None
    trade = "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/"
    seller = party("cac:AccountingSupplierParty/cac:Party" if ubl else trade + "ram:SellerTradeParty")
    buyer = party("cac:AccountingCustomerParty/cac:Party" if ubl else trade + "ram:BuyerTradeParty")
    line_nodes = root.findall("cac:InvoiceLine" if ubl else "rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem", ns)
    content = []
    content_ready = bool(line_nodes) and len(line_nodes) <= 2000
    for line in line_nodes[:2000]:
        quantity = one(line, "cbc:InvoicedQuantity" if ubl else "ram:SpecifiedLineTradeDelivery/ram:BilledQuantity")
        name = text(one(line, "cac:Item/cbc:Name" if ubl else "ram:SpecifiedTradeProduct/ram:Name"))
        total = text(one(line, "cbc:LineExtensionAmount" if ubl else "ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount"))
        tax_path = "cac:Item/cac:ClassifiedTaxCategory" if ubl else "ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax"
        taxes = []
        for tax in line.findall(tax_path, ns):
            category = text(one(tax, "cbc:ID" if ubl else "ram:CategoryCode"))
            percent = text(one(tax, "cbc:Percent" if ubl else "ram:RateApplicablePercent"))
            taxes.append([category, decimal(percent) if percent is not None else None])
        period_path = "cac:InvoicePeriod" if ubl else "ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod"
        line_periods = []
        for period in line.findall(period_path, ns):
            start = text(one(period, "cbc:StartDate" if ubl else "ram:StartDateTime/udt:DateTimeString[@format='102']"))
            end = text(one(period, "cbc:EndDate" if ubl else "ram:EndDateTime/udt:DateTimeString[@format='102']"))
            line_periods.append([start.replace("-", "") if start else None, end.replace("-", "") if end else None])
        qty = decimal(text(quantity))
        unit = quantity.get("unitCode") if quantity is not None else None
        net = decimal(total)
        if not name or qty is None or not unit or net is None or not taxes:
            content_ready = False
        content.append({"name": name, "quantity": qty, "unit": unit, "net": net,
                        "taxes": sorted(taxes, key=lambda x: json.dumps(x)), "periods": line_periods})
    # Header charges, allowances and explicit performance references participate
    # in similarity. A differing period must not collapse into the same content.
    charges = []
    charge_path = "cac:AllowanceCharge" if ubl else "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge"
    for charge in root.findall(charge_path, ns):
        flag = text(one(charge, "cbc:ChargeIndicator" if ubl else "ram:ChargeIndicator/udt:Indicator"))
        value = decimal(text(one(charge, "cbc:Amount" if ubl else "ram:ActualAmount")))
        category = text(one(charge, "cac:TaxCategory/cbc:ID" if ubl else "ram:CategoryTradeTax/ram:CategoryCode"))
        percent = decimal(text(one(charge, "cac:TaxCategory/cbc:Percent" if ubl else "ram:CategoryTradeTax/ram:RateApplicablePercent")))
        if flag not in {"true", "false"} or value is None:
            content_ready = False
        charges.append([flag, value, category, percent])
    order = text(one(root, "cac:OrderReference/cbc:ID" if ubl else trade + "ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID"))
    delivery = observed("BT-72")
    performance = {"periods": [[[v.get("isoDate") for v in period.get(term, {}).get("values", [])]
                                for term in ("BT-73", "BT-74")] for period in periods],
                   "delivery": delivery.get("isoDate") if delivery else None, "order": order}
    digest = None
    if content_ready and currency:
        payload = {"lines": sorted(content, key=lambda x: json.dumps(x, sort_keys=True)),
                   "charges": sorted(charges, key=lambda x: json.dumps(x)), "performance": performance}
        digest = sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    result = {"contract": CONTRACT, "sourceSha256": source_hash,
              "invoiceType": invoice_type if invoice_type and re.fullmatch(r"[0-9]{3}", invoice_type) else None,
              "number": number["original"].strip() if number and len(number["original"].strip()) <= 256 else None,
              "issueDate": issued.get("isoDate") if issued else None, "amount": amount, "currency": currency,
              "seller": seller, "buyer": buyer, "contentDigest": digest, "lineCount": len(line_nodes),
              "performanceContextPresent": bool(periods or delivery or order or any(x["periods"] for x in content)),
              "issues": sorted(issues), "authority": "DOCUMENT_CLAIMS_ONLY"}
    if len(json.dumps(result).encode()) > 24576:
        return {"contract": CONTRACT, "sourceSha256": source_hash, "issues": ["signal_size_limit"],
                "authority": "DOCUMENT_CLAIMS_ONLY"}
    return result
