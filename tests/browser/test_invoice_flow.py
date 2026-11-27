"""Portable local browser regression with real handlers, KoSIT and SQL RPCs.

The authentication and Supabase query transport are explicitly test adapters.
Run after the backend, decision-test and mobile builds; resources are pinned
in tests/invoice-resources.json. No hosted account or payment is used.
"""
import json
import hashlib
import os
from pathlib import Path
import select
import subprocess
import time

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]


def main():
    resources = Path(os.environ["PETRAPLAN_INVOICE_FIXTURES"])
    output = Path(os.environ.get("PETRAPLAN_BROWSER_OUTPUT", "/tmp/petraplan-browser-results.json"))
    env = {**os.environ, "PETRAPLAN_BROWSER_FIXTURE": "1"}
    process = subprocess.Popen(["node", "tests/browser/invoice-harness.mjs"], cwd=ROOT,
                               env=env, stdout=subprocess.PIPE, text=True)
    report = {"scope": "local-browser-handlers-worker-PGlite-test-auth", "checks": []}

    def check(name, condition):
        report["checks"].append({"name": name, "passed": bool(condition)})
        assert condition, name
        print("PASS: " + name, flush=True)

    try:
        deadline = time.monotonic() + 60
        config = None
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("Local harness stopped before readiness")
            if select.select([process.stdout], [], [], 1)[0]:
                line = process.stdout.readline()
                try:
                    candidate = json.loads(line)
                    if "origin" in candidate:
                        config = candidate
                        break
                except json.JSONDecodeError:
                    pass
        if config is None:
            raise RuntimeError("Local harness readiness timed out")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get("PETRAPLAN_CHROMIUM_PATH"))
            page = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True)
            page.set_default_timeout(30000)
            page.set_default_navigation_timeout(30000)
            page_errors = []
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(config["origin"] + "/") else route.abort())
            session = {"access_token": config["token"], "refresh_token": "local-only",
                       "expires_at": int(time.time()) + 3600, "user": {"id": config["actorId"]}}
            page.add_init_script("localStorage.setItem('sb-yxhllviostywckxoehgf-auth-token'," + json.dumps(json.dumps(session)) + ")")
            headers = {"Authorization": "Bearer " + config["token"]}

            def independent_page():
                context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
                independent = context.new_page()
                independent.set_default_timeout(30000)
                independent.on("pageerror", lambda error: page_errors.append(str(error)))
                independent.route("**/*", lambda route: route.continue_() if route.request.url.startswith(config["origin"] + "/") else route.abort())
                second_session = {**session, "access_token": config["approverToken"], "user": {"id": config["approverId"]}}
                independent.add_init_script("localStorage.setItem('sb-yxhllviostywckxoehgf-auth-token'," + json.dumps(json.dumps(second_session)) + ")")
                return context, independent

            def download_original(current_page, expected_file):
                with current_page.expect_download() as pending_download:
                    current_page.get_by_role("button", name="Original-PDF herunterladen", exact=True).first.click()
                downloaded = Path(pending_download.value.path()).read_bytes()
                assert hashlib.sha256(downloaded).digest() == hashlib.sha256((resources / expected_file).read_bytes()).digest()

            def submit_exception(current_page, button, expected_status=200):
                with current_page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/invoice-exception")) as pending:
                    current_page.get_by_role("button", name=button, exact=True).click()
                assert pending.value.status == expected_status, pending.value.text()
                return pending.value.json()

            def trace(record):
                response = page.request.get(config["origin"] + "/api/cases/" + record, headers=headers)
                assert response.status == 200, response.text()
                return response.json()

            def upload(filename, new=True):
                if new:
                    page.goto(config["origin"] + "/cases")
                page.locator('input[type="file"]').set_input_files(resources / filename)
                with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/bridge/invoice-upload"), timeout=120000) as pending:
                    page.get_by_role("button", name="Datei prüfen und speichern", exact=True).click()
                response = pending.value
                assert response.status in (200, 201), response.text()
                record = response.json()["record_id"]
                expect(page.get_by_role("region", name="Rechnungsprüfung")).to_be_visible()
                return record

            record = upload("0114-ubl.xml")
            state = trace(record)
            check("upload creates no certificate", len(state["release"]["certificates"]) == 0)
            first_snapshot = state["source"]["ingestion"]["id"]
            panel = page.get_by_role("region", name="Rechnungsprüfung")
            expect(panel.get_by_role("button", name="Review bestätigen", exact=True)).to_be_visible()
            for label in ("Original geprüft", "Zuordnung geprüft", "Offene Punkte geklärt"):
                panel.get_by_label(label, exact=True).check()
            panel.get_by_label("Begründung", exact=True).fill("Explicit local browser review")
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/decision")):
                panel.get_by_role("button", name="Review bestätigen", exact=True).click()
            expect(panel.get_by_role("button", name="Freigabe erteilen", exact=True)).to_be_visible()
            check("review still creates no certificate", len(trace(record)["release"]["certificates"]) == 0)
            panel.get_by_label("Begründung", exact=True).fill("Explicit separate local test release")
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/decision")):
                panel.get_by_role("button", name="Freigabe erteilen", exact=True).click()
            expect(panel.get_by_text("Freigegeben", exact=True).first).to_be_visible()
            check("explicit separate release creates one certificate", len(trace(record)["release"]["certificates"]) == 1)

            upload("0114-ubl.xml", new=False)
            check("identical repeat reuses snapshot", trace(record)["source"]["ingestion"]["id"] == first_snapshot)
            upload("0114-uncefact.xml", new=False)
            state = trace(record)
            check("revision revokes previous certificate", state["release"]["effective_status"] == "revoked")
            check("both source versions remain available", len(state["invoice"]["snapshots"]) == 2)

            # Newly supported scenario: genuine KoSIT acceptance, no auto-release.
            general = upload("cen-huf-cii.xml")
            state = trace(general)
            check("general EN16931 reaches review", state["invoice"]["snapshots"][0]["proof"]["accepted"] is True)
            check("general EN16931 does not auto-release", len(state["release"]["certificates"]) == 0)

            french = upload("facturx-invoice.pdf")
            state = trace(french)
            snapshot = state["invoice"]["snapshots"][0]
            check("French payable is matched by whole-page OCR", snapshot["pdfComparison"]["status"] == "NEEDS_VISUAL_CONFIRMATION")
            panel = page.get_by_role("region", name="Rechnungsprüfung")
            expect(panel.get_by_text("OCR-Betrag passt zum XML. Sichtbestätigung steht aus.", exact=True)).to_be_visible()
            check("PDF still requires independent visual review", len(state["release"]["certificates"]) == 0)
            if os.environ.get("PETRAPLAN_BROWSER_SCREENSHOTS"):
                directory = Path(os.environ["PETRAPLAN_BROWSER_SCREENSHOTS"])
                directory.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=directory / "french-pdf.png", full_page=True)

            # Genuine negative XML: mutate only the payable of a known original.
            altered = (resources / "0114-ubl.xml").read_bytes().replace(b"12829.69</cbc:PayableAmount>", b"12830.69</cbc:PayableAmount>")
            assert altered != (resources / "0114-ubl.xml").read_bytes()
            page.goto(config["origin"] + "/cases")
            page.locator('input[type="file"]').set_input_files({"name": "invalid.xml", "mimeType": "application/xml", "buffer": altered})
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/bridge/invoice-upload"), timeout=120000) as pending:
                page.get_by_role("button", name="Datei prüfen und speichern", exact=True).click()
            rejected = pending.value.json()["record_id"]
            panel = page.get_by_role("region", name="Rechnungsprüfung")
            expect(panel.get_by_text("KoSIT hat die XML abgelehnt", exact=True)).to_be_visible()
            check("negative XML retains no certificate", len(trace(rejected)["release"]["certificates"]) == 0)
            check("negative XML offers no release button", panel.get_by_role("button", name="Freigabe erteilen", exact=True).count() == 0)

            # Real OCR, original download, API and database independence guards.
            # These PDFs are controlled representations, not a fresh foreign-data experiment.
            conflict = upload("different.pdf")
            before = trace(conflict)
            original_validation = before["validation"]["authoritative"]["id"]
            original_snapshot = before["source"]["ingestion"]["id"]
            check("different PDF remains blocked", before["invoice"]["snapshots"][0]["pdfComparison"]["status"] == "DIFFERENT"
                  and len(before["release"]["certificates"]) == 0)
            page.get_by_label("Belegverweis", exact=True).fill("Controlled browser clarification document")
            page.get_by_label("Erlaubter Verwendungszweck", exact=True).fill("Invoice analysis in isolated test only")
            page.get_by_label("Begründung der Ausnahme", exact=True).fill("Controlled visible discrepancy documented for independent review")
            expect(page.get_by_role("button", name="Ausnahme beantragen", exact=True)).to_be_disabled()
            download_original(page, "different.pdf")
            check("original PDF download matches uploaded bytes", True)
            submit_exception(page, "Ausnahme beantragen")
            expect(page.get_by_text("PDF-Ausnahme beantragt", exact=True)).to_be_visible()
            check("exception request creates no certificate", len(trace(conflict)["release"]["certificates"]) == 0)
            page.get_by_label("Begründung der Ausnahme", exact=True).fill("Uploader attempts to approve own exception request")
            download_original(page, "different.pdf")
            submit_exception(page, "Ausnahme genehmigen", 403)
            expect(page.get_by_role("alert")).to_contain_text("independent")
            check("uploader cannot approve own request", trace(conflict)["invoice"]["snapshots"][0]["exception"]["status"] == "PENDING")

            second_context, second = independent_page()
            second.goto(config["origin"] + "/cases/" + conflict)
            second.get_by_label("Begründung der Ausnahme", exact=True).fill("Independent assessment of originals and controlled clarification")
            expect(second.get_by_role("button", name="Ausnahme genehmigen", exact=True)).to_be_disabled()
            download_original(second, "different.pdf")
            approved = submit_exception(second, "Ausnahme genehmigen")
            expect(second.get_by_text("Dokumentierte PDF-Ausnahme", exact=True)).to_be_visible()
            after = trace(conflict)
            check("independent approval creates separate validation", after["validation"]["authoritative"]["id"] == approved["validation_id"]
                  and approved["validation_id"] != original_validation)
            check("original failed validation remains in history", any(v["id"] == original_validation and v["status"] == "failed" for v in after["validation"]["results"]))
            check("approval alone creates no certificate", len(after["release"]["certificates"]) == 0)
            page.reload()
            panel = page.get_by_role("region", name="Rechnungsprüfung")
            expect(panel.get_by_text("Dokumentierte PDF-Ausnahme", exact=True)).to_be_visible()
            check("uploader has no exception review or release controls", panel.get_by_role("button", name="Review bestätigen", exact=True).count() == 0
                  and panel.get_by_role("button", name="Freigabe erteilen", exact=True).count() == 0)
            forged = page.request.post(config["origin"] + "/api/cases/" + conflict + "/decision", headers=headers, data={
                "action": "approve_review", "reason": "Uploader tries to reuse independent approval", "expected_snapshot_id": original_snapshot,
                "expected_validation_id": approved["validation_id"], "criteria": {"source_truth_checked": True, "translation_trace_checked": True, "blockers_resolved": True}})
            check("API rejects uploader review after independent approval", forged.status == 403)
            second_panel = second.get_by_role("region", name="Rechnungsprüfung")
            for label in ("Original geprüft", "Zuordnung geprüft", "Offene Punkte geklärt"):
                second_panel.get_by_label(label, exact=True).check()
            delivery = second_panel.get_by_label("Beleg zum Liefer- oder Leistungszeitraum (BR-DE-TMP-32)", exact=True)
            if delivery.count():
                delivery.fill("Controlled service-period evidence for this browser fixture")
            second_panel.get_by_label("Begründung", exact=True).fill("Independent review of limited-purpose exception")
            with second.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/decision")) as pending:
                second_panel.get_by_role("button", name="Review bestätigen", exact=True).click()
            assert pending.value.status == 200, pending.value.text()
            expect(second_panel.get_by_role("button", name="Freigabe erteilen", exact=True)).to_be_visible()
            check("independent exception review still creates no certificate", len(trace(conflict)["release"]["certificates"]) == 0)
            second_panel.get_by_label("Begründung", exact=True).fill("Separate explicit release for documented limited purpose")
            with second.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/decision")) as pending:
                second_panel.get_by_role("button", name="Freigabe erteilen", exact=True).click()
            assert pending.value.status == 200, pending.value.text()
            expect(second.get_by_text("Ausnahmefreigabe", exact=True).first).to_be_visible()
            released = trace(conflict)
            check("exception release is labelled and bound to decision", released["release"]["effective_status"] == "exception"
                  and len(released["release"]["certificates"]) == 1
                  and released["release"]["certificates"][0]["truth_snapshot"]["invoice_exception_id"] == approved["decision_id"])
            check("exception mobile layout has no horizontal overflow", second.evaluate("document.documentElement.scrollWidth <= innerWidth"))
            if os.environ.get("PETRAPLAN_BROWSER_SCREENSHOTS"):
                second.screenshot(path=Path(os.environ["PETRAPLAN_BROWSER_SCREENSHOTS"]) / "pdf-exception-release.png", full_page=True)

            upload("positive.pdf", new=False)
            revised = trace(conflict)
            check("new PDF revision revokes exception release", revised["release"]["effective_status"] == "revoked")
            check("old exception becomes unusable and both PDFs remain", len(revised["invoice"]["snapshots"]) == 2
                  and any(s["snapshotId"] == original_snapshot and s["exception"]["usable"] is False for s in revised["invoice"]["snapshots"]))
            check("new PDF revision does not inherit exception", all(s.get("exception") is None for s in revised["invoice"]["snapshots"] if s["current"]))

            ambiguous = upload("ambiguous.pdf")
            ambiguous_state = trace(ambiguous)
            check("multiple visible amounts stay uncomparable", ambiguous_state["invoice"]["snapshots"][0]["pdfComparison"]["status"] == "NOT_COMPARABLE")
            page.get_by_label("Belegverweis", exact=True).fill("Controlled ambiguous PDF evidence")
            page.get_by_label("Erlaubter Verwendungszweck", exact=True).fill("No onward use without clarification")
            page.get_by_label("Begründung der Ausnahme", exact=True).fill("Two conflicting visible payable amounts require clarification")
            download_original(page, "ambiguous.pdf")
            submit_exception(page, "Ausnahme beantragen")
            second.goto(config["origin"] + "/cases/" + ambiguous)
            second.get_by_label("Begründung der Ausnahme", exact=True).fill("Rejected because the ambiguity has no sufficient supporting evidence")
            submit_exception(second, "Ausnahme ablehnen")
            expect(second.get_by_text("PDF-Ausnahme abgelehnt", exact=True)).to_be_visible()
            denied = trace(ambiguous)
            check("rejected exception retains failed validation and no certificate", denied["validation"]["authoritative"]["status"] == "failed"
                  and len(denied["release"]["certificates"]) == 0)
            second_context.close()

            negative_state = trace(rejected)
            bad_exception = page.request.post(config["origin"] + "/api/cases/" + rejected + "/invoice-exception", headers=headers, data={
                "action": "REQUEST", "snapshotId": negative_state["source"]["ingestion"]["id"],
                "validationId": negative_state["validation"]["authoritative"]["id"], "reason": "Attempted exception for a technically rejected XML",
                "evidenceReference": "No acceptable evidence", "purpose": "Must remain blocked"})
            check("rejected XML cannot enter PDF exception process", bad_exception.status == 409)

            # Display-only probe: a structurally unusable report can still carry
            # a genuine positive validator assessment. Do not mutate the DB.
            diagnostic = trace(rejected)
            diagnostic["invoice"]["snapshots"][0]["proof"].update(
                {"validatorDecision": "accept", "accepted": False, "reportContractStatus": "STEP_SET_MISMATCH"})
            diagnostic_url = config["origin"] + "/api/cases/" + rejected
            page.route(diagnostic_url, lambda route: route.fulfill(json=diagnostic))
            page.goto(config["origin"] + "/cases/" + rejected)
            expect(page.get_by_text("KoSIT akzeptiert · Prüfbeleg nicht verwendbar", exact=True)).to_be_visible()
            check("diagnostic rendering does not misattribute bridge rejection to KoSIT",
                  page.get_by_text("KoSIT hat die XML abgelehnt", exact=True).count() == 0)
            check("mobile layout has no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
            check("no JavaScript page errors", page_errors == [])
            check("unauthenticated API request is rejected", page.request.get(config["origin"] + "/api/cases").status == 401)
            check("unknown test identity is rejected", page.request.get(config["origin"] + "/api/cases", headers={"Authorization": "Bearer unknown-local-identity"}).status == 401)
            check("raw token without Bearer scheme is rejected", page.request.get(config["origin"] + "/api/cases", headers={"Authorization": config["token"]}).status == 401)
            browser.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{len(report['checks'])} local browser conditions passed; test authentication, not hosted acceptance.")


if __name__ == "__main__":
    main()
