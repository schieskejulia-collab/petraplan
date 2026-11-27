"""Download public, hash-pinned local invoice test resources; never credentials."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def prepare(destination, verify_only=False):
    manifest = json.loads((ROOT / "tests/invoice-resources.json").read_text())
    destination.mkdir(parents=True, exist_ok=True)

    def download(item, target):
        if not target.is_file() or sha256(target.read_bytes()).hexdigest() != item["sha256"]:
            if verify_only:
                raise ValueError(f"Missing or changed resource: {target.name}")
            with urllib.request.urlopen(item["url"], timeout=90) as response:
                data = response.read(64 * 1024 * 1024 + 1)
            if len(data) > 64 * 1024 * 1024 or sha256(data).hexdigest() != item["sha256"]:
                raise ValueError(f"Resource digest mismatch: {target.name}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)

    for key in ("validator", "configuration"):
        item = manifest[key]
        download(item, destination / item["filename"])
    config = destination / "config"
    if not verify_only:
        with zipfile.ZipFile(destination / manifest["configuration"]["filename"]) as archive:
            for name in archive.namelist():
                if not (config / name).resolve().is_relative_to(config.resolve()):
                    raise ValueError("Unsafe archive path")
            archive.extractall(config)
    for item in manifest["configuration"]["files"]:
        file = config / item["path"]
        if not file.is_file() or sha256(file.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError(f"Configuration mismatch: {item['path']}")
    for item in manifest["inputs"]:
        download(item, destination / "inputs" / item["filename"])
    for item in manifest.get("peppol", []):
        download(item, destination / "peppol" / item["path"])
    print(json.dumps({"jar": str(destination / "validator.jar"),
                      "scenarios": str(config / "scenarios.xml"),
                      "inputs": str(destination / "inputs"),
                      "verifiedConfigurationFiles": len(manifest["configuration"]["files"]),
                      "verifiedInputs": len(manifest["inputs"])}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    prepare(args.destination.resolve(), args.verify_only)
