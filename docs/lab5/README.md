# Lab 5 — Booking Web Manager

SC2006 Group 3's narrated application demo. The final export runs **6:30.3**, below the seven-minute limit, at 1920×1080 / 30 FPS with H.264 video, AAC narration, synchronized captions and original closing sound effects.

## Deliverables

- [Final demo video](../../output/lab5-video/booking-web-manager-lab5-remotion-v6.mp4)
- [SRT captions](../../output/lab5-video/booking-web-manager-lab5-remotion-v6.srt)
- [Portable production source ZIP](../../output/lab5-video/booking-web-manager-lab5-remotion-v6-source.zip)
- [Story map](video/story-map-remotion-v6.md), [narration script](video/narration-remotion-v6.md) and [timeline manifest](../../output/lab5-video/booking-web-manager-lab5-remotion-v6.timeline.json)
- [Export verification report](../../output/lab5-video/booking-web-manager-lab5-remotion-v6.verification.json) and [source asset checksums](../../output/lab5-video/booking-web-manager-lab5-remotion-v6.source-assets.json)
- [Landing preview](../../output/lab5-video/booking-web-manager-remotion-v6-landing-preview.mp4) and [animated ending with sound](../../output/lab5-video/booking-web-manager-remotion-v6-ending-with-sound-preview.mp4)
- [Remotion project and rebuild instructions](video/remotion/README.md)

## Downloading the media

The MP4, WAV and ZIP assets use [Git LFS](https://git-lfs.com/). Install Git LFS, then retrieve the actual media after cloning:

```sh
git lfs install
git lfs pull
```

On GitHub, open an individual file and use its download control to retrieve the media. A standard source-code archive may contain LFS pointers; the separately tracked production ZIP contains the portable assets themselves.

## Story and scope

An off-app agreement falls through before any session is joined or money committed in the app. Neoh discovers the landing page and manually creates a public tennis session. Harrison and Joseph join through their own accounts; separate prepared examples demonstrate withdrawal policies, attendance, payout readiness and a regular group. The ending animates the change from playing alone to a group selfie, then credits **Booking Web Manager by SC2006 Group 3**.

The public landing page is recorded from the live application. Funded and time-dependent scenes are actual UI recordings in an explicitly labelled isolated demo environment. The cancellation and social payoff are dramatizations. The production does not change application behavior, APIs, database schemas or real balances. It is separate from Lab 4 artifacts.

The verification report covers encoded duration and format, full decode, narration alignment, captions, silent gaps, UI return frames, continuous landing footage and closing sound effects. It does not claim a continuous human listening review.

Application checks run from the repository root; the independent Remotion project's lint and type checks run from `docs/lab5/video/remotion` after its own `npm ci`.
