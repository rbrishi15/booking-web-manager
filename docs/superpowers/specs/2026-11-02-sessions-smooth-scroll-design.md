# Scroll-following timeline in “I'm playing”

The user requested smoother scrolling on the Sessions page and clarified that the dot should follow scrolling, then the nearby card should open after a short pause.

## Approach

Use native document scrolling with a passive scroll observer. Move the dot continuously along the rail at the viewport reading line, clamped to the first and last dates. After 200 ms without further scrolling, smoothly open the nearest date's card over 280 ms. Anchor that date in the viewport while the previous card collapses. Keep the dot at its reading position throughout the pause and expansion; do not snap it back to a date when scrolling stops. Explicit date/row clicks start their smooth transition immediately.

The alternative of tuning gesture thresholds retains wheel interception and does not produce continuous scroll progress.

## Behavior and constraints

- Never prevent wheel/trackpad input or consume momentum.
- Move the marker during scrolling before changing the open card. Pausing within the current card must leave the marker where scrolling put it.
- Restart the 200 ms pause on further input. Cancel pending work on explicit selection, dialog opening, resize, hidden tabs and unmount.
- Ignore the timeline's own scroll corrections to avoid selection loops.
- Keep keyboard navigation on date controls; page keys elsewhere remain native.
- Preserve reduced motion, URL restoration, pagination anchoring, dialogs and mobile lists.
- No global scroll animation, dependencies, data changes or hosting-view redesign.
