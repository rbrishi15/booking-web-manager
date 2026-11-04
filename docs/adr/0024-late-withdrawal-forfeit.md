# ADR-0024: A late withdrawal may forfeit its share and close the place

- Status: Accepted
- Date: 2026-11-03
- Extends: the either/or departure choice in [ADR-0006](./0006-personal-replacement-reservations.md)
  with a forfeit choice for late withdrawals. The 30-hour refund boundary and
  settlement are unchanged.

## Context

A participant who withdraws less than 30 hours before the start must today
choose who gets their place: open it to the waitlist, or invite one named
person by user ID. Players who simply cannot come, and do not want to find or
wait for a replacement, had no way to say so. The team confirmed on
3 November 2026 that such a player may instead give up their share, and that
the place then **closes**: nobody else can take it.

## Decision

The user clarified on 3 November 2026 that the choices depend on the time
remaining until the start:

| Time remaining | Allowed departure choices |
| --- | --- |
| At least 30 hours, including exactly 30 hours | Open to the waitlist or invite one person |
| Less than 30 hours | Invite one person or forfeit the share |

A new late `OPEN_SLOT` withdrawal (including the domain's omitted-mode
default) is refused with `INVALID_STATE` before any state changes. Previously
recorded late open-slot withdrawals remain readable and retain their existing
replacement/refund behavior; no historical record is rewritten. The dialog
uses the server's preview to show the allowed choices, clears a waitlist
selection when the cutoff passes, and refreshes the choices if the server
rejects a stale request after the final preview.

`FORFEIT` becomes a third `ReplacementMode`, available only for a late
withdrawal. At 30 hours or more before the start a withdrawal is refunded in
full, so a forfeit request is refused with `INVALID_STATE`; it names no
invitee (`INVALID_INPUT` otherwise).

In the withdrawal's single unit of work the participation becomes `WITHDRAWN`
with replacement mode `FORFEIT`, and its hold moves `HELD` →
`AWAITING_REPLACEMENT` → `FORFEITURE_DUE` at once instead of waiting for the
start. The result kind is `FORFEITURE_DUE`, with no ledger instruction and
nothing refunded. Money still moves only at settlement: the existing payout
path forfeits a `FORFEITURE_DUE` hold to the booker exactly as it does for an
unmatched late withdrawal, and reliability counts it the same way.

The place stays closed for the rest of the session. `forfeitedPlaces` (a
`WITHDRAWN` participation with mode `FORFEIT`) counts against capacity beside
commitments and pending named reservations, in `Session.getAvailableSlots`,
admission, roster validation and the scheduled promotion query. A forfeit is
never matched as a replacement, so no follow-up promotion runs and no
forfeiture warning is sent: the share is already the booker's.

Cancelling the session still refunds every held share, including a
forfeited one, and clears the replacement mode as for any other withdrawal.

## Consequences

- Migration 0022 widens `participations.replacement_mode` to accept
  `FORFEIT`; no existing row changes.
- `POST /api/sessions/withdraw` accepts `{ mode: "FORFEIT" }` and may return
  kind `FORFEITURE_DUE`. The withdrawal preview is unchanged: forfeiting is a
  choice made only when withdrawing.
- The withdrawal dialog offers "Forfeit my share" only when the preview shows
  a late withdrawal, and "Open it to the waitlist" only for an early withdrawal.
- A booker may collect a forfeited share for a place that then stays empty.
  This is the intended trade for the player's immediate exit; the booker
  cannot reopen the place.
