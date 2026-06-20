import pandas as pd

def load_csv(file_path: str):
    """Load CSV file and return DataFrame."""
    try:
        return pd.read_csv(file_path)
    except Exception as e:
        raise ValueError(f"CSV konnte nicht geladen werden: {e}")

