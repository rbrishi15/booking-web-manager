"""Package only the portable Remotion production, its media and verified evidence."""
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "docs/lab5/video"
OUT = ROOT / "output/lab5-video"
PROJECT = SOURCE / "remotion"
report = json.loads((OUT / "booking-web-manager-lab5-remotion-v6.verification.json").read_text())
assert report["status"] == "passed"
data = json.loads((PROJECT / "src/timeline.json").read_text())
files = [ROOT / "docs/lab5/README.md"]
for name in ["package.json", "package-lock.json", "tsconfig.json", "remotion.config.ts", "eslint.config.mjs", ".prettierrc", ".gitignore", "README.md"]:
    files.append(PROJECT / name)
for directory in ["src", "scripts", "public/screens", "public/posters", "public/fonts"]:
    files.extend(p for p in (PROJECT / directory).rglob("*") if p.is_file() and p.name != ".DS_Store")
files.extend(PROJECT / "public/audio" / c["audio_file"] for c in data["chapters"])
files.extend({OUT / q["audio"] for c in data["chapters"] for q in c["cues"]})
files.extend(SOURCE / name for name in ["verify_remotion_v6.py", "package_remotion_v6.py", "README-remotion-v6.md", "story-map-remotion-v6.md", "narration-remotion-v6.md", "remotion-basic-captions-reference.md", "script-social-ending.json", "script-academic-credit.json", "measure_wordmark.py", "social-payoff-animation-v5.md", "record_window_v6.swift", "conform_landing_v6.py", "generate_endcard_sfx_v6.py", "endcard-sfx-v6.json"])
for extension in ["srt", "timeline.json", "verification.json", "story-map.md", "narration.md"]:
    files.append(OUT / ("booking-web-manager-lab5-remotion-v6." + extension))
files.append(OUT / "remotion-v6-qa/studio-caption-layout.json")
files.append(OUT / "review/v6-gradual-scroll-inspection.jpg")
files.append(OUT / "review/v6-final-scenes.jpg")

for name in ["opening-after-cutoff.png", "dot-in-flight.png", "dot-settled.png", "social-alone.png", "social-group-selfie.png", "final-academic-credit.png"]:
    files.append(OUT / "remotion-v6-qa" / name)
files.append(OUT / "booking-web-manager-remotion-v6-ending-with-sound-preview.mp4")
files.extend((OUT / "remotion-v6-qa").glob("caption-sheet-*.jpg"))
files.append(OUT / "booking-web-manager-remotion-v6-landing-preview.mp4")
files.append(OUT / "remotion-v6-qa/assembly-provenance.json")
files.append(PROJECT / "public/audio/endcard-foley-v6.wav")
files.append(PROJECT / "public/audio/ending-v5.wav")
for name in ["live-landing-continuous-take-g.mp4", "selected-take-manifest.json", "take-g-events.json"]:
    files.append(OUT / "rerecord-v6" / name)
assert all(p.is_file() for p in files)
assert all(not any(part in {"node_modules", ".git", ".env", ".env.local"} for part in p.relative_to(ROOT).parts) for p in files)
assert all((PROJECT / "public/screens" / f"{i:02d}.mp4").is_file() for i in range(1, 29))
manifest = {str(p.relative_to(ROOT)): {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(set(files))}
manifest_path = OUT / "booking-web-manager-lab5-remotion-v6.source-assets.json"
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
files.append(manifest_path)
archive = OUT / "booking-web-manager-lab5-remotion-v6-source.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
    bundle.writestr("README.md", (SOURCE / "README-remotion-v6.md").read_text())
    for p in sorted(set(files)):
        bundle.write(p, str(p.relative_to(ROOT)))
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    for name, expected in manifest.items():
        payload = bundle.read(name)
        assert len(payload) == expected["bytes"] and hashlib.sha256(payload).hexdigest() == expected["sha256"], name
print(f"Verified portable source ZIP: {archive}; {len(set(files))+1} entries; {archive.stat().st_size / 1048576:.1f} MiB")
