# Booking Web Manager — Remotion V6

The final video is [`booking-web-manager-lab5-remotion-v6.mp4`](../../../../output/lab5-video/booking-web-manager-lab5-remotion-v6.mp4): 390.3 seconds (6:30.3), 1920×1080, 30 FPS, H.264/AAC. See the [Lab 5 delivery index](../../README.md) for captions, the source archive and validation evidence.

V6 replaces the final UI recap with a fictional animated social payoff: Neoh alone on the court; Harrison and Joseph arrive; they gather for a selfie; a flash and camera move turn the moment into a keepsake photo. It then dissolves into the monochrome academic closing. Two glossy side spheres and the logo fade in; the i-dot bounces to the full-stop position, resolves into the exact app wordmark, and reveals Booking Web Manager / by SC2006 Group3 / Thank you for watching. All motion is frame-driven Remotion React/SVG, not a slideshow or a prerecorded template.

## Rebuild

The source ZIP preserves the `docs/lab5/video/remotion` and `output/lab5-video` directory layout. It includes the native UI media, local fonts, narration WAVs, captions, exact measured glyph geometry, authored scene source and pinned dependencies. Rendering needs no account, application API, database, voice service or credentials.

Prerequisites: Node22+, npm and FFmpeg/ffprobe. Python3 with Pillow is needed only for export verification.

When cloning from GitHub, install [Git LFS](https://git-lfs.com/) first and run `git lfs pull` from the repository root. Video, audio and source archive files are tracked with LFS. The application and this production have separate npm dependencies and checks.

From `docs/lab5/video/remotion`:

```sh
npm ci
npm run lint
npm run dev -- --no-open
npm run render
```

Open the printed Studio URL. `BookingDemo` is the full composition; `ending`, `SocialPayoff` and `AcademicEndCard` are independent editable previews. The render script creates a high-quality muted picture and then normalizes the included narration to -16LUFS/-1.5dBTP target, adds48kHz/192kbps AAC and encodes a true10Mbps CBR H.264 final. Narration is never accelerated. No file-size cap is applied.

From the bundle root:

```sh
python3 -m pip install Pillow
python3 docs/lab5/video/verify_remotion_v6.py
```

The verifier reads the included fresh Studio layout audit, then checks the actual export. If editing caption styles, timing or layouts, rerun the Studio inspection as well; the Python verifier does not control a browser.

## Authored source

- `src/SocialPayoffScene.tsx`: native court, same three illustrated identities, walk-in motion, smiling faces, raised phone, camera framing, shutter flash and animated photo reveal.
- `src/FancyEndCard.tsx`: two glossy spheres, exact Inter Black wordmark and measured i-dot bounce; staged academic title, credit and thanks.
- `src/EndingScene.tsx`:15.6-second social animation and16-second academic card with600ms overlap.
- `src/wordmark-metrics.json`: measured geometry from the actual Inter900 font. `measure_wordmark.py` documents the optional measurement method using FontTools and uharfbuzz; rendering uses the included JSON.
- `src/BookingLogo.tsx`: mirrors `components/ui/booking-logo.tsx` — Booking., Inter900, normal tracking and case.
- `src/PhoneMockup.tsx`, `OpeningScene.tsx`, `DeskScene.tsx`: iPhone chat, landing-page reveal and distinct named player-to-monitor transitions.
- `src/PlanChangeScenes.tsx`: cue-aligned early/refund/waitlist/late/replacement diagrams, separate from account changes.
- `src/FocusedFootage.tsx`: gentle camera emphasis on attendance, payout readiness, pending invitations and accepted status.
- `src/Chapters.tsx`: authored chapter sequences and inline captions/audio. Edit this source or Studio directly; the historical editorial generators are not needed for portable rendering.
- `src/timeline.json`, `portals.json`: full timing, scene provenance, measured narration, original/conformed clip mapping and camera windows.
- `src/VideoChrome.tsx`, `style.css`: slim actor/environment header and neutral #20252A captions, #F5F5F3 text,23px/500, max2 lines,180ms fades. A cue-end guard clears captions during silent gaps.
- `public/screens`: actual native screen recordings and documented idle-only conform trims. `public/posters` supplies brief context within illustrated desktop transitions.
- `public/audio/*-v5.wav and ending-v6.wav`: completed chapter narration tracks. Phrase masters are also included under `output/lab5-video/audio-michael` for verification.

Same matched reference voice: Kokoro am_michael via Apple MLX at natural speed1.0. Resynthesis is unnecessary for a portable rebuild. `script-social-ending.json` and `script-academic-credit.json` preserve the new text and pronunciation choices.

## Editing choices

The off-app cancellation is dramatized before any session membership or funds commitment. Neoh is a new user and manually creates the public session. The landing footage is from the live site; funded, time-dependent authenticated scenes are genuine recordings in the labelled isolated demo environment. Main-game success is preserved while separate48-hour and10-hour policy examples are demonstrated. No private-to-public conversion, in-app opening withdrawal or actual bank transfer is implied.

Routine entry is accelerated where already labelled; saved confirmations, wallet holds and replacement acceptance remain readable at1×. Time was removed from loading/idle footage and redundant explanations. Player switches keep identity holds and camera moves, while policy examples use distinct motion language. The social payoff uses continuous character and camera motion, with a readable hold after the selfie before the logo sequence.

## Validation scope

The export report records exact duration/format/frame count and8–12Mbps acceptance, complete decode,62 phrase waveform positions,65 SRT pages, all visible Studio caption texts,46 cleared silent gaps, encoded caption contrast samples,14 return-to-UI comparisons and the actual encoded i-dot removal/restoration. Representative opening, financial, group-invitation, social and credit frames are visually inspected. A continuous human listening review is not performed; waveform alignment does not claim that review.

The source bundle is allowlisted, includes an SHA-256 asset manifest, excludes caches/node_modules/venvs/environment files and includes the measured verification report. The full MP4 is delivered separately.

## V6: smooth recorded landing and dot foley

A new native Chrome-window take replaces the four old landing excerpts. The selected range is one continuous downward traversal. Scrolls are recorded in small increments, then timed to the existing narration; motion-compensated frame-rate conversion is restricted to those scroll windows. Dense movement samples avoid the distorted letters seen in rejected large-jump tests. The selected original take, native recorder, conformance source and source-range manifest are included. No discarded test takes are packaged.

`public/screens/neoh-landing-handle-v6.mp4` and `landing-v6.mp4` are adjacent portions of `landing-full-v6.mp4`. The public-site chapter ends on a settled hosting view. `LiveToPreparedBridge.tsx` provides an explicit38.1–40.3-second handoff into the existing prepared account rather than cutting mid-scroll into a dashboard.

`generate_endcard_sfx_v6.py` creates original quiet air, two soft bounce taps and a final settling tick. `endcard-sfx-v6.json` preserves the event timings and levels. The foley is mixed into `ending-v6.wav` for the main composition; the standalone AcademicEndCard loads the separate foley WAV. `EndingScene` disables that duplicate source, so it never plays twice. Spoken audio and SRT pages keep their measured timing. No background music is added.

For this edit, the current first50 seconds were rendered freshly and the verified unchanged V5 picture tail was reused before a single10Mbps encode with the complete current audio. The boundary was checked against an identical source frame. The source bundle rebuilds the complete390.3-second composition using `npm run render`; it does not need a previous MP4.

The actual-export verifier additionally compares the encoded closing sound effects to their source waveform, checks that all source ranges are contiguous, and records the prefix/tail assembly provenance.
