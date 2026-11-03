# Sessions trackpad responsiveness

> Execute inline with `superpowers:executing-plans`; review the complete branch before opening the PR.

**Goal:** Keep card-by-card navigation while responding to deliberate new trackpad input during a previous gesture's inertia.

**Design:** Keep `TimelineGesture` as the input boundary and preserve the existing finite card animation. A full 24 px reversal is new intent. For a renewed push in the same direction, require a decayed tail followed by two substantial inputs, rather than treating one rogue spike as another swipe. Explicit browser momentum always remains inertia. Keep the 220 ms quiet fallback and native ownership at feed boundaries.

**CI diagnosis:** Both failing jobs on `main` measure the details footer during the dialog's 200 ms opening animation. Wait for the actual dialog animations before taking the reference measurement; retain the existing geometric assertions.

**Files:** `timeline-gesture.ts` owns classification; its unit tests cover packet sequences; `sessions-timeline.spec.ts` exercises the real hook and transitions in Chromium/WebKit. Update `app/sessions/README.md` with the gesture contract.

**Native scroll recovery:** If the selected card leaves the reading viewport, a deliberate wheel gesture resumes at the visible row nearest the sticky header. Reset old page ownership once on entering recovery, accumulate the normal 24 px intent even if native scrolling changes the candidate, and preserve explicit-momentum filtering. Ordinary document scrolling alone retains selection. Cover returning from the bottom, recovery with the old selection above the viewport, moving candidates, and normal adjacent navigation afterwards.

## Steps

- [x] Add unit and browser regressions for immediate reversal, renewed same-direction pushes, and inertia/noise rejection; run against the baseline and observe failures.
- [x] Implement fresh-intent recognition without changing selection, URL, mobile, keyboard, or nested scrolling behavior.
- [x] Await dialog opening animations before the CI test's footer measurement.
- [x] Run unit tests, typecheck, lint, build, and Chromium/WebKit timeline tests. Review the branch.

**Delivery:** Commit semantically, push, and create a PR against `main`.

## Review focus

- Initial acceleration must advance only one card.
- Tiny reverse jitter and isolated tail spikes must not navigate.
- Explicit momentum must never start or queue navigation.
- A deliberate gesture during an animation must queue only one neighboring card.
- Boundary gestures, dialog scrolling, pagination anchoring, and reduced motion retain their existing behavior.
