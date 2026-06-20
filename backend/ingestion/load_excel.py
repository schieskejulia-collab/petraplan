import pandas as pd

def load_excel.py (file_path: str):
    """Load excel file and return DataFrame."""
    try:
        return pd.read_csv(file_path)
    except Exception as e:
        raise ValueError(f"excel konnte nicht geladen werden: {e}")
