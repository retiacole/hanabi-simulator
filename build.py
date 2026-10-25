"""Build the standalone index.html; requires only Python 3."""
from pathlib import Path

root = Path(__file__).resolve().parent
source = root / "src"
html = (source / "shell.html").read_text(encoding="utf-8")
for placeholder, filename in [
    ("MODEL_SOURCE", "fireworks-model.js"),
    ("SMOKE_SOURCE", "smoke-model.js"),
    ("APP_SOURCE", "app.js"),
]:
    marker = "/* " + placeholder + " */"
    if html.count(marker) != 1:
        raise ValueError(f"Expected exactly one {marker} placeholder")
    html = html.replace(marker, (source / filename).read_text(encoding="utf-8"))
output = root / "index.html"
output.write_text(html, encoding="utf-8")
print(f"Built {output.name}: {len(html.encode('utf-8'))} bytes")
