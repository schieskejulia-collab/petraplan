import json
from datetime import datetime, timezone
from typing import Optional
from .database import get_connection
from .logger import log


def save_analysis(
    business_name: str,
    industry: str,
    source: str,
    input_data: dict,
    output_data: dict,
) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO analysis_history
                (created_at, business_name, industry, source, input_json, output_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                now,
                business_name,
                industry,
                source,
                json.dumps(input_data, ensure_ascii=False),
                json.dumps(output_data, ensure_ascii=False),
            ),
        )
        conn.commit()
        record_id = cursor.lastrowid
        log.info("Saved analysis #%d for '%s' (source=%s)", record_id, business_name, source)
        return record_id


def get_history(limit: int = 50, offset: int = 0) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, created_at, business_name, industry, source
            FROM analysis_history
            ORDER BY id DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]


def get_analysis_by_id(record_id: int) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM analysis_history WHERE id = ?", (record_id,)
        ).fetchone()
        if not row:
            return None
        data = dict(row)
        data["input_json"] = json.loads(data["input_json"])
        data["output_json"] = json.loads(data["output_json"])
        return data


def delete_analysis(record_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM analysis_history WHERE id = ?", (record_id,)
        )
        conn.commit()
        deleted = cursor.rowcount > 0
        if deleted:
            log.info("Deleted analysis #%d", record_id)
        return deleted
