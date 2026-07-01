"""
Tests for /api/history endpoints.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

PROFILE = {
    "business_name": "History Test GmbH",
    "industry": "E-Commerce",
    "tools": ["Shopify"],
    "premium_active": False,
    "user_yes_for_automation": False,
}


def _create_entry() -> int:
    r = client.post("/api/analyze", json=PROFILE)
    assert r.status_code == 200
    h = client.get("/api/history?limit=1&offset=0")
    return h.json()["items"][0]["id"]


class TestHistory:
    def test_history_returns_200(self):
        r = client.get("/api/history")
        assert r.status_code == 200

    def test_history_schema(self):
        r = client.get("/api/history")
        data = r.json()
        assert "items" in data
        assert "limit" in data
        assert "offset" in data

    def test_analyze_saves_to_history(self):
        before = len(client.get("/api/history?limit=100").json()["items"])
        client.post("/api/analyze", json=PROFILE)
        after = len(client.get("/api/history?limit=100").json()["items"])
        assert after == before + 1

    def test_history_item_has_correct_fields(self):
        client.post("/api/analyze", json=PROFILE)
        items = client.get("/api/history?limit=1").json()["items"]
        assert len(items) > 0
        item = items[0]
        for key in ("id", "created_at", "business_name", "industry", "source"):
            assert key in item

    def test_history_detail_returns_full_data(self):
        record_id = _create_entry()
        r = client.get(f"/api/history/{record_id}")
        assert r.status_code == 200
        data = r.json()
        assert "input_json" in data
        assert "output_json" in data

    def test_history_detail_404(self):
        r = client.get("/api/history/999999")
        assert r.status_code == 404

    def test_history_delete(self):
        record_id = _create_entry()
        r = client.delete(f"/api/history/{record_id}")
        assert r.status_code == 200
        assert r.json()["deleted"] is True

    def test_history_delete_404(self):
        r = client.delete("/api/history/999999")
        assert r.status_code == 404

    def test_history_delete_removes_entry(self):
        record_id = _create_entry()
        client.delete(f"/api/history/{record_id}")
        r = client.get(f"/api/history/{record_id}")
        assert r.status_code == 404

    def test_history_pagination_limit(self):
        r = client.get("/api/history?limit=2")
        assert len(r.json()["items"]) <= 2

    def test_history_source_rule(self):
        client.post("/api/analyze", json=PROFILE)
        items = client.get("/api/history?limit=1").json()["items"]
        assert items[0]["source"] == "rule"