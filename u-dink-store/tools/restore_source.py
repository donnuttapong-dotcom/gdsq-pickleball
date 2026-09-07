from pathlib import Path
import base64
import zipfile

root = Path(__file__).resolve().parents[1]
archive_dir = root / "archive"

parts = sorted(archive_dir.glob("U_DINK_STORE_ALL_SOURCE.zip.b64.part*"))
if not parts:
    raise SystemExit("Archive parts not found.")

payload = "".join(p.read_text(encoding="utf-8").strip() for p in parts)
zip_path = root / "U_DINK_STORE_ALL_SOURCE.zip"
zip_path.write_bytes(base64.b64decode(payload))

extract_dir = root / "restored-source"
extract_dir.mkdir(exist_ok=True)

with zipfile.ZipFile(zip_path, "r") as z:
    z.extractall(extract_dir)

print(f"Restored archive: {zip_path}")
print(f"Extracted source: {extract_dir}")
