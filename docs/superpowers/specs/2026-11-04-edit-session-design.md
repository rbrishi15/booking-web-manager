# Edit session

The user approved an Edit session dialog on the participant page, with venue,
sport, date/time, capacity, price and visibility. Venue, sport, schedule and price
lock once another player has joined. Capacity and visibility remain editable
before an OPEN session starts. The dialog loads current values, explains locked
fields, validates inputs, saves persistently, and refreshes the participant page.

## Approaches

- **Dialog (selected):** keeps the participant list in context and follows the
  existing Radix dialogs. Responsive, scrollable content accommodates the fields.
- **Separate page:** more space, but adds navigation for this focused operation.

## Rules and implementation choices

- Only the active session owner can read or save editing details.
- Booking details include venue name, region, sport, Singapore start/end times,
  total venue cost and price per player. Existing creation pricing bounds apply
  when changing an unjoined session's cost or price; an unchanged accepted price
  remains accepted when only capacity changes.
- A participation history locks booking details, including withdrawn/waitlisted
  players and legacy paid booker records, so prior commitments remain intact.
- Capacity includes the booker, occupied, reserved and forfeited places. It may
  never drop below these places. Existing maximum capacity is 30 (legacy 31 is
  preserved when unchanged). Capacity increases do not promote the waitlist.
- Visibility follows the existing available-capacity rule. An unchanged value
  does not block capacity edits on a full session.
- Validate under the shared parent-row lock in a serializable transaction; use
  a version from the loaded details to reject stale edits rather than overwrite
  changes. Failed saves preserve form input and offer reload on conflicts.
- No wallet, hold, participation, sidebar or invitation changes. No deployment
  or live database mutation. The existing session columns need no migration.

## Acceptance

Test owner access, lifecycle boundaries, commitment locks, reserved capacity,
price validation, stale saves and persistence. Exercise dialog open/save/cancel,
pending/error/conflict states, focus, and narrow-screen layout. Run unit tests,
focused Storybook/browser checks, typecheck, lint and build.
