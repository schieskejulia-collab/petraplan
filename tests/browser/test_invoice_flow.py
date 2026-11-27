"""Portable local browser regression with real handlers, KoSIT and SQL RPCs.

The authentication and Supabase query transport are explicitly test adapters.
Run after the backend, decision-test and mobile builds; resources are pinned
in tests/invoice-resources.json. No hosted account or payment is used.
"""
import json
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
            # Display-only probe: a structurally unusable report can still carry
            # a genuine positive validator assessment. Do not mutate the DB.
            diagnostic = trace(rejected)
            diagnostic["invoice"]["snapshots"][0]["proof"].update(
                {"validatorDecision": "accept", "accepted": False, "reportContractStatus": "STEP_SET_MISMATCH"})
            diagnostic_url = config["origin"] + "/api/cases/" + rejected
            page.route(diagnostic_url, lambda route: route.fulfill(json=diagnostic))
            page.reload()
            expect(page.get_by_text("KoSIT akzeptiert · Prüfbeleg nicht verwendbar", exact=True)).to_be_visible()
            check("diagnostic rendering does not misattribute bridge rejection to KoSIT",
                  page.get_by_text("KoSIT hat die XML abgelehnt", exact=True).count() == 0)
            check("mobile layout has no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
            check("no JavaScript page errors", page_errors == [])
            check("unauthenticated API request is rejected", page.request.get(config["origin"] + "/api/cases").status == 401)
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
