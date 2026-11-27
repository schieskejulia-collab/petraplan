"""Controlled PDF visual-review probes; no PDF/A or ZUGFeRD conformance claim."""
import argparse
from pathlib import Path

import fitz


def create(directory):
    xml = (directory / "01.01a-uncefact.xml").read_bytes()
    for name, rows in [("positive.pdf", [(100, "Zahlbetrag 336,90 EUR")]),
                       ("different.pdf", [(100, "Zahlbetrag 337,90 EUR")]),
                       ("ambiguous.pdf", [(100, "Zahlbetrag 336,90 EUR"), (500, "Zahlbetrag 337,90 EUR")])]:
        with fitz.open() as doc:
            page = doc.new_page()
            for y, text in rows:
                page.insert_text((72, y), text, fontsize=16)
            doc.embfile_add("factur-x.xml", xml)
            doc.save(directory / name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    create(parser.parse_args().directory)
