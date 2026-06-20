from ingestion.load_csv import load_csv
from ingestion.load_excel import load_excel
from ingestion.load_text import load_text

from middleware.access.free_mode import is_free_mode
from middleware.access.premium_gate import request_premium
from middleware.access.approval_lever import require_approval

def ingest_file(file_path: str, premium: bool = False):
    """
    Load a file and return schema + preview.
    Premium features require explicit approval.
    """

    # Free Mode always active
    if not premium and is_free_mode():
        pass  # Free Mode allowed

    # Premium requested
    if premium:
        return {
            "premium_requested": True,
            "approval_required": require_approval()
        }

    # File loading
    if file_path.endswith(".csv"):
        df = load_csv(file_path)
    elif file_path.endswith(".xlsx") or file_path.endswith(".xls"):
        df = load_excel(file_path)
    elif file_path.endswith(".txt"):
        df = load_text(file_path)
    else:
        raise ValueError("Dateiformat wird nicht unterstützt.")

    # Basic free-mode analysis
    schema = {
        "columns": list(df.columns),
        "types": df.dtypes.astype(str).to_dict()
    }

    preview = df.head().to_dict(orient="records")

    return {
        "mode": "free",
        "schema": schema,
        "preview": preview
    }
