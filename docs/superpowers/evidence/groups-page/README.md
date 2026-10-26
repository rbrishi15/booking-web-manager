# Groups page verification

Chromium screenshots use the synchronous Storybook fixtures in
`app/groups/_components/groups-view.stories.tsx`. Names, memberships, roles, and
statuses here are sample data; production cards use the authenticated member's
groups. The shared sidebar is unchanged.

| View | Screenshot |
| --- | --- |
| Desktop dark, 1536px | [Preview](desktop-dark.webp) |
| Desktop light, 1536px | [Preview](desktop-light.webp) |
| Mobile dark, 390px | [Preview](mobile-dark.webp) |
| Mobile light, 390px | [Preview](mobile-light.webp) |

Both phone themes and the long-name fixture have `scrollWidth === clientWidth`
at 390px. Independent review also checked the two-column layout at 1100px and
1440px, archived links, and mobile creation-dialog focus/keyboard behavior.

Validation commands:

- `npm test`: 3158 passed; 42 skipped; 1 todo.
- `npm run test:storybook -- app/groups/_components/groups-view.stories.tsx`: 9 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed, including staged Storybook.

New server-page tests were first observed failing for the missing display
projection, then passed after integration. The independent review identified a
join-date fixture that used identical dates for every member; it now gives the
viewer a distinct date so a wrong-member selection is detected.
