# Groups page revamp

Revamp `/groups` using the user's final card-based reference: a simple “Groups / Your groups” introduction, prominent creation action, and two columns of large image cards on desktop. Cards stack in one column on mobile. The final reference supersedes the earlier banner, row list, search, sorting, and view switch. The user chose a responsive revamp with creation in a dialog and the shared sidebar preserved.

The supplied reference is specifically for dark mode. Match its dark visual treatment there; light mode uses the same structure with light surfaces, softer borders, and appropriate contrast.

Use the existing Next/React, Radix dialog, theme tokens, and court assets, supplemented by a matching racket image. Retain the authenticated group query and all group actions. Pass only display data to the client; invitation tokens and member IDs remain server-side. Show real membership names/initials, counts, roles, joined dates, invitation status, and archived status. Descriptions, profile photos, and custom group covers are not currently available; court covers are decorative, and the supporting copy uses invitation status and the viewer's join date. No schema, API, domain, or detail-page changes.

## Approaches

- Responsive image cards (selected by the user's final reference): a calm heading and two columns of cards, each with a large photo, group name, role, member preview, and onward arrow.
- Earlier directory layout (superseded): court banner, rows, search and sorting controls.

## Acceptance

All groups, including archived groups, remain reachable. Creation keeps the existing action, validation, and redirect. Dialog keyboard focus, long names, empty/one-member groups, leave confirmation, and both themes work at mobile and desktop widths. No horizontal overflow at 390px. Only display information reaches client props.
