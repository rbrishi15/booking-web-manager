# Direct timeline session switching

## Final agreed interaction

Keep the existing desktop Joined timeline design. Wheel/trackpad gestures switch
to another session without smooth page scrolling. The current card first closes
over 160 ms, then the compact destination is positioned instantly. All cards
remain collapsed while input continues. After 200 ms of quiet in the compact
view, only the selected card opens over 280 ms. Reduced motion retains the pause and opens immediately.

The user explicitly replaced free scrolling with direct switching, then chose
"Collapse all while scrolling", then requested a smooth closing transition before
changing sessions because the instantaneous collapse felt confusing. This
supersedes the earlier free-scroll plan.
The date marker eases between selected dates over 180 ms, finishing before the
card opens. A reversal redirects it from its current position. Reduced motion
places it immediately. Page scrolling remains instant.
Clicking a date/compact row and focused-date keyboard navigation switch directly
and begin opening immediately. The header, imagery, typography, mobile list,
organising view, URL restoration, pagination and details dialog are retained.
No public API, domain or database changes.

## Implementation

- Branch from current origin/main in an isolated worktree.
- Separate selection from expansion: the selected date can have a collapsed card.
- Remove animated page seeks and navigation queues behind opening animations.
- Retain main's gesture intent/momentum handling independently of card animation.
- Close the current card over 160 ms, then position the selected row instantly.
- Retarget additional input during closing without restarting the close.
- Restart the 200 ms opening timer on every owned wheel packet, including momentum.
- Reserve the unused expanded-card space in bottom padding so the document and
  scrollbar keep their height while cards collapse and reopen.
- Native scrollbar movement collapses cards, preserves the nearby row's viewport
  position, then settles onto that session after the pause. Preserve page exit
  beyond first/last dates, nested scrollers, and dialog input.
- Cancel stale timers/frames on new selection, dialog, resize, hidden document,
  feed changes and unmount.

## Validation and delivery

- Prove the direct-switch regression fails against the earlier free-scroll version.
- Verify closing-before-positioning, all cards collapsed for the pause, no interpolated
  scroll positions, one final expansion, momentum/reversal and repeated input.
- Cover boundaries, short feeds, keyboard/click controls, URL/dialog/focus,
  pagination, responsive sizes and reduced motion.
- Run Chromium/WebKit/Firefox tests, timeline Storybook, units, build, types/lint.
- Compare broader Storybook failures with clean main; record limitations.
- Review the final interaction, record a demonstration, then create a semantic
  commit and ready-for-review PR targeting main. Verify exact-head CI and preview.

## Verification record

Before implementation, main's build and 3,514 unit tests passed. The final direct
switch regression failed on the preceding free-scroll implementation: wheel input
passed through instead of switching to the compact next session.

Broader Sessions Storybook has nine existing failures reproduced on clean main:
Waits For Confirmation; Joined Long Venue (light/dark/mobile/mobile dark);
Joined Waitlisted; Review Refund; Joined Session Details Dialog; In Progress
Hosted Management. Main additionally failed Chronological Timeline contrast in
that run. These independent fixture/accessibility failures are outside this change.

Firefox 155 on this macOS27 host requires a fresh temporary app-data home for
headless testing ([Playwright issue 42768](https://github.com/microsoft/playwright/issues/42768)).
Local test-only CFFIXED_USER_HOME isolates it; CI runs the normal Firefox project
on Linux. No browser permissions are changed. Automated input does not constitute
physical trackpad testing.

Final implementation validation: 3,514 unit tests, all 36 timeline Storybook
stories, typecheck, lint, production build, and diff checks passed. The 69-case
browser matrix exposed two short-window details-click failures; both were fixed
and all 12 affected resize/scrollbar/short-window/dialog checks passed across
Chromium, WebKit, and Firefox. The full matrix is rerun for the PR commit.
