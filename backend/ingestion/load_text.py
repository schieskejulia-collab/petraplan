import pandas as pd

def load_text(file_path: str):
    """Load text file and return DataFrame."""
    try:
        return pd.read_csv(file_path)
    except Exception as e:
        raise ValueError(f"text konnte nicht geladen werden: {e}")
