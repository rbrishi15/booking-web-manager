# accounts/participant test cases

Snapshot: **2026-10-24, payout refactor** · **77 cases, 77 passed**. See the [domain testing guide](../../README.md) and [execution evidence](../../results/README.md).

Each row is one executed test. Columns before **Expected Result** are inputs; **Expected Result** is the oracle and **Test Result** is the log. Test results are assertion-verified outcomes from the dated passing run, not captured runtime payloads. The first input value links to the test definition. Only checked fields are reported; matching fields do not imply equality of an entire returned object.

Shared defaults: session `s`, owner `booker`, public visibility, `OPEN`, two slots, minimum headcount two, booking cost 1,000 cents and share 500 cents. The booking runs 10 October 2026, 10:00–12:00 UTC; relative times below use its start or end. Accounts are active with verified email, 10,000 available cents, reliability 100 and no groups unless a row says otherwise. Existing participants use IDs `p-<user>`, holds `h-<user>` and wallets `w-<user>`. Committed participants have a 500-cent `HELD` hold; waiters have no hold and receive queue positions in listed order, starting at 1. Empty rosters and no payout history are the default.

“Session unchanged” means the test compares the complete observed session snapshot: lifecycle, visibility, invited group, queue counter, payout identities/batch, the captured participation and hold fields. It does not claim equality of unobserved state.

Unless stated otherwise, admission and replacement acceptance use participation ID `p-<applicant>` and hold ID `h-<applicant>`; promotion supplies the hold ID, while withdrawal and waitlist departure target the participation ID. Commands run 48 hours before start unless a row gives another time. Existing commitments and waitlist entries began 48 hours before start. Relative withdrawal times are written as −N h. `OPEN_SLOT` offers a vacancy to the queue; `DIRECT_INVITE` reserves it for the named user. Withdrawal entries are `WITHDRAWN` with `AWAITING_REPLACEMENT` holds unless another hold state is shown. Input rows override these defaults explicitly.

## join — account and session eligibility

The two `participant` rows request participation ID `participation` and hold ID `hold`; the missing-email cara row omits the hold ID. Deactivation receives zero available/held balances and zero counts for commitments, unsettled sessions, pending payouts and owned groups.

**Input:** Applicant, Account / role timing, Email, Committed users, Available funds (cents), Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **6 passed / 6 cases**.

| Applicant | Account / role timing | Email | Committed users | Available funds (cents) | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [participant](admission.test.ts#L24) | INACTIVE after role creation | Cleared by deactivation | None | 0 | 48 h | Error code `INACTIVE_ACCOUNT`; session participations empty. | Error code `INACTIVE_ACCOUNT`; session participations empty. |
| [participant](admission.test.ts#L51) | INACTIVE before role creation | Absent | None | 0 | 48 h | Error code `INACTIVE_ACCOUNT`; session participations empty. | Error code `INACTIVE_ACCOUNT`; session participations empty. |
| [cara](admission.test.ts#L71) | ACTIVE | Absent | alice, ben | 10,000 | 48 h | Error code `EMAIL_REQUIRED`; session unchanged. | Error code `EMAIL_REQUIRED`; session unchanged. |
| [alice](admission.test.ts#L92) | ACTIVE | Present, unverified | None | 10,000 | 48 h | Admission `COMMITTED`; alice `COMMITTED`; hold `HELD`, 500 cents; loaded wallet available balance remains 10,000 cents. | Admission `COMMITTED`; alice `COMMITTED`; hold `HELD`, 500 cents; loaded wallet available balance remains 10,000 cents. |
| [alice](admission.test.ts#L111) | INACTIVE | Absent | None | 10,000 | 48 h | Error code `INACTIVE_ACCOUNT`; session unchanged. | Error code `INACTIVE_ACCOUNT`; session unchanged. |
| [ben](admission.test.ts#L130) | ACTIVE | Present, verified | None | 10,000 | 0 h | Error code `SESSION_STARTED`; session unchanged. | Error code `SESSION_STARTED`; session unchanged. |

## join — private-session access

Applicant is alice; each session is `PRIVATE`, has room token `room`, and starts with an empty roster.

**Input:** Invited group, Minimum reliability, Applicant groups, Applicant reliability, Supplied room token · **Oracle:** Expected Result · **Log:** Test Result

Execution: **5 passed / 5 cases**.

| Invited group | Minimum reliability | Applicant groups | Applicant reliability | Supplied room token | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [group](admission.test.ts#L148) | 80 | None | 100 | Omitted | Error code `INVALID_ACCESS`; session unchanged. | Error code `INVALID_ACCESS`; session unchanged. |
| [group](admission.test.ts#L171) | 80 | group | 79 | Omitted | Error code `LOW_RELIABILITY`; session unchanged. | Error code `LOW_RELIABILITY`; session unchanged. |
| [group](admission.test.ts#L198) | 80 | group | 80 | Omitted | Admission `COMMITTED`; first instruction wallet `w-alice`. | Admission `COMMITTED`; first instruction wallet `w-alice`. |
| [None](admission.test.ts#L224) | None | None | 100 | Omitted | Error code `INVALID_ACCESS`, message “The user does not have access to this private session”; session unchanged. | Error code `INVALID_ACCESS`, message “The user does not have access to this private session”; session unchanged. |
| [None](admission.test.ts#L249) | None | None | 100 | room | Admission `COMMITTED`. | Admission `COMMITTED`. |

## join — wallet funds

Each target session has an empty roster and a 500-cent share. Instruction lists are exact in length; only the stated instruction fields are asserted.

**Input:** Applicant, Available funds (cents), Wallet history, Participation ID, Hold ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Applicant | Available funds (cents) | Wallet history | Participation ID | Hold ID | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [participant](admission.test.ts#L269) | 10,000 | Funded top-up | participation | hold | Admission `COMMITTED`; participation belongs to `participant`; exactly one instruction with kind `LOCK`, wallet `w-participant`, participation `participation`, hold `hold`, amount 500 cents. | Admission `COMMITTED`; participation belongs to `participant`; exactly one instruction with kind `LOCK`, wallet `w-participant`, participation `participation`, hold `hold`, amount 500 cents. |
| [alice](admission.test.ts#L294) | 500 | Funded top-up | p-alice | h-alice | Admission `COMMITTED`; exactly one instruction with kind `LOCK`, participation `p-alice`, hold `h-alice`, wallet `w-alice`, amount 500 cents. | Admission `COMMITTED`; exactly one instruction with kind `LOCK`, participation `p-alice`, hold `h-alice`, wallet `w-alice`, amount 500 cents. |
| [alice](admission.test.ts#L319) | 499 | Funded top-up | p-alice | h-alice | Error code `INSUFFICIENT_FUNDS`; session unchanged. | Error code `INSUFFICIENT_FUNDS`; session unchanged. |
| [alice](admission.test.ts#L338) | 0 after reload; original wallet 500 | 500-cent top-up and persisted 500-cent LOCK from prior admission | p-alice | h-alice | Error code `INSUFFICIENT_FUNDS`; next session unchanged; original wallet available balance 500 cents, reloaded wallet 0 cents. | Error code `INSUFFICIENT_FUNDS`; next session unchanged; original wallet available balance 500 cents, reloaded wallet 0 cents. |

## join — waitlist admission

**Input:** Applicant, Committed users, Existing waiters, Available funds (cents), Hold ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Applicant | Committed users | Existing waiters | Available funds (cents) | Hold ID | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [cara](admission.test.ts#L381) | alice, ben | None | 499 | Omitted | Error code `INSUFFICIENT_FUNDS`; session unchanged. | Error code `INSUFFICIENT_FUNDS`; session unchanged. |
| [cara](admission.test.ts#L401) | alice, ben | None | 500 | Omitted | Exact admission: `WAITLISTED`, participation `p-cara`, empty instructions; cara `WAITLISTED`, hold absent; next waiter cara. | Exact admission: `WAITLISTED`, participation `p-cara`, empty instructions; cara `WAITLISTED`, hold absent; next waiter cara. |
| [evan](admission.test.ts#L429) | ben | cara, dana | 10,000 | h-evan | Admission `WAITLISTED`; instructions empty; evan queue position 3; next waiter cara; next queue sequence 4; available slots 1. | Admission `WAITLISTED`; instructions empty; evan queue position 3; next waiter cara; next queue sequence 4; available slots 1. |

## join — participation history and reentry

**Input:** Applicant, Prior participation, Requested participation ID, Committed users, Waiting / departed entries · **Oracle:** Expected Result · **Log:** Test Result

Execution: **5 passed / 5 cases**.

| Applicant | Prior participation | Requested participation ID | Committed users | Waiting / departed entries | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [cara](admission.test.ts#L458) | p-cara LEFT_WAITLIST, position 1 | different | alice, ben | cara departed; dana waiting at 2 | Error code `DUPLICATE_ID`; session unchanged. | Error code `DUPLICATE_ID`; session unchanged. |
| [cara](admission.test.ts#L482) | p-cara LEFT_WAITLIST, position 1 | p-cara | alice, ben | cara departed; dana waiting at 2 | Admission `WAITLISTED`; next waiter dana; exactly one cara entry; roster order `[alice, ben, cara, dana]`; cara position 3, next sequence 4; new participant-list object. Old list still references the same departed cara object (`LEFT_WAITLIST`, position 1), next sequence 3, committed count 2. | Admission `WAITLISTED`; next waiter dana; exactly one cara entry; roster order `[alice, ben, cara, dana]`; cara position 3, next sequence 4; new participant-list object. Old list still references the same departed cara object (`LEFT_WAITLIST`, position 1), next sequence 3, committed count 2. |
| [alice](admission.test.ts#L528) | p-alice COMMITTED | p-alice | alice | None | Error code `ALREADY_PARTICIPATING`; session unchanged. | Error code `ALREADY_PARTICIPATING`; session unchanged. |
| [alice](admission.test.ts#L546) | p-alice WITHDRAWN at −48 h; OPEN_SLOT; REFUNDED at −48 h | p-alice | None | None | Error code `REJOIN_NOT_ALLOWED`; session unchanged. | Error code `REJOIN_NOT_ALLOWED`; session unchanged. |
| [alice](admission.test.ts#L575) | p-alice REMOVED; REFUNDED at −48 h | p-alice | None | None | Error code `REJOIN_NOT_ALLOWED`; session unchanged. | Error code `REJOIN_NOT_ALLOWED`; session unchanged. |

## join — replacement reservations and refund failure

**Input:** Applicant, Committed users, Withdrawals / reservations, Waiting history, Time before start, Refund failure · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Applicant | Committed users | Withdrawals / reservations | Waiting history | Time before start | Refund failure | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [dana](waitlist.test.ts#L30) | alice | ben: −10 h, DIRECT_INVITE to cara | None | 9 h | None | Exact admission: `WAITLISTED`, participation `p-dana`, empty instructions; next waiter dana; ben hold `AWAITING_REPLACEMENT`; committed count 1; available slots 0. | Exact admission: `WAITLISTED`, participation `p-dana`, empty instructions; next waiter dana; ben hold `AWAITING_REPLACEMENT`; committed count 1; available slots 0. |
| [cara](replacement-reservations.test.ts#L43) | None | alice: −20 h, OPEN_SLOT; ben: −10 h, DIRECT_INVITE to cara | None | 9 h | None | Error code `INVALID_STATE`; session unchanged; no cara participation; cara reservation still targets `p-ben`; alice hold `AWAITING_REPLACEMENT`; available slots 1. | Error code `INVALID_STATE`; session unchanged; no cara participation; cara reservation still targets `p-ben`; alice hold `AWAITING_REPLACEMENT`; available slots 1. |
| [replacement](admission.test.ts#L647) | ben | alice: −2 h, OPEN_SLOT | former-waiter LEFT_WAITLIST at position 1 | 1 h | INVALID_STATE: Replacement refund failed | Error code `INVALID_STATE`: “Replacement refund failed”; session unchanged. | Error code `INVALID_STATE`: “Replacement refund failed”; session unchanged. |

## acceptReplacement — accept a reserved seat

Acceptance uses each invitee’s default participation and hold IDs; no room token is supplied. Sessions are public except the explicitly private row.

**Input:** Invitee, Email verified, Committed users, Withdrawals / reservations, Waitlist, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Invitee | Email verified | Committed users | Withdrawals / reservations | Waitlist | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [cara](replacement-reservations.test.ts#L14) | No | alex | ben: −10 h, DIRECT_INVITE to cara | None | 9 h | Admission `COMMITTED`; cara participation `COMMITTED`. | Admission `COMMITTED`; cara participation `COMMITTED`. |
| [cara](replacement-reservations.test.ts#L124) | Yes | alex | ben: −10 h, DIRECT_INVITE to cara | dana, cara, evan | 9 h | Admission `COMMITTED`, refunded participation `p-ben`; instruction kinds `[LOCK, REFUND]`; cara `COMMITTED`, position 2, replaces `p-ben`; next waiter dana; next sequence stays 4; committed count 2; available slots 0. | Admission `COMMITTED`, refunded participation `p-ben`; instruction kinds `[LOCK, REFUND]`; cara `COMMITTED`, position 2, replaces `p-ben`; next waiter dana; next sequence stays 4; committed count 2; available slots 0. |
| [cara](admission.test.ts#L601) | Yes | None | alice: −20 h, DIRECT_INVITE to donna; ben: −19 h, DIRECT_INVITE to cara; PRIVATE session | None | 18 h | Refunded participation `p-ben`; instruction kinds `[LOCK, REFUND]`; alice hold `AWAITING_REPLACEMENT`; cara replaces `p-ben`; available slots 0. | Refunded participation `p-ben`; instruction kinds `[LOCK, REFUND]`; alice hold `AWAITING_REPLACEMENT`; cara replaces `p-ben`; available slots 0. |
| [cara](replacement-reservations.test.ts#L302) | Yes | None | ben: −40 h, DIRECT_INVITE to cara, REFUNDED at −40 h; alice: −20 h, OPEN_SLOT | None | 19 h | Admission `COMMITTED`; refunded participation absent; instruction kinds `[LOCK]`; cara replaces `p-ben`; ben retains the same `REFUNDED` hold object; alice hold `AWAITING_REPLACEMENT`; available slots 1. | Admission `COMMITTED`; refunded participation absent; instruction kinds `[LOCK]`; cara replaces `p-ben`; ben retains the same `REFUNDED` hold object; alice hold `AWAITING_REPLACEMENT`; available slots 1. |

## acceptReplacement — preserve reservations on rejection

ben withdrew at −10 h using `DIRECT_INVITE` to cara, with a 500-cent `AWAITING_REPLACEMENT` hold. The applicant requests their default participation/hold IDs.

**Input:** Applicant, Account, Funds (cents), Reliability / minimum, Other committed users, Waitlist, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **5 passed / 5 cases**.

| Applicant | Account | Funds (cents) | Reliability / minimum | Other committed users | Waitlist | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [dana](replacement-reservations.test.ts#L90) | ACTIVE | 10,000 | 100 / none | alex | None | 9 h | Error code `INVALID_ACCESS`; session unchanged; available slots 0; ben invitee remains cara. | Error code `INVALID_ACCESS`; session unchanged; available slots 0; ben invitee remains cara. |
| [cara](replacement-reservations.test.ts#L171) | ACTIVE | 499 | 100 / none | alex | dana, cara | 9 h | Error code `INSUFFICIENT_FUNDS`; session unchanged; available slots 0; cara queue position 2. | Error code `INSUFFICIENT_FUNDS`; session unchanged; available slots 0; cara queue position 2. |
| [cara](replacement-reservations.test.ts#L208) | INACTIVE | 10,000 | 100 / none | alex | None | 9 h | Error code `INACTIVE_ACCOUNT`; session unchanged. | Error code `INACTIVE_ACCOUNT`; session unchanged. |
| [cara](replacement-reservations.test.ts#L239) | ACTIVE | 10,000 | 79 / 80 | None | None | 9 h | Error code `LOW_RELIABILITY`; session unchanged. | Error code `LOW_RELIABILITY`; session unchanged. |
| [cara](replacement-reservations.test.ts#L271) | ACTIVE | 10,000 | 100 / none | None | None | 0 h | Error code `SESSION_STARTED`; session unchanged. | Error code `SESSION_STARTED`; session unchanged. |

## acceptReplacement — reject replay

ben is the only original participant and directly invites cara. cara first accepts with `p-cara` / `h-cara`, then attempts the same participation ID with a different hold ID.

**Input:** Ben withdrawal time / hold, First acceptance time, Later ordinary join, Replay time before start, Replay hold ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Ben withdrawal time / hold | First acceptance time | Later ordinary join | Replay time before start | Replay hold ID | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [−10 h / AWAITING_REPLACEMENT](admission.test.ts#L695) | −9 h | None | 8 h | h-another | First admission `COMMITTED`, refunded participation `p-ben`; available slots 1; replay error code `INVALID_ACCESS`; session unchanged by replay. | First admission `COMMITTED`, refunded participation `p-ben`; available slots 1; replay error code `INVALID_ACCESS`; session unchanged by replay. |
| [−10 h / AWAITING_REPLACEMENT](admission.test.ts#L735) | −9 h | dana at −8 h, p-dana / h-dana | 7 h | h-another | Available slots 0; replay error code `INVALID_ACCESS`; session unchanged by replay. | Available slots 0; replay error code `INVALID_ACCESS`; session unchanged by replay. |
| [−40 h / REFUNDED at −40 h](replacement-reservations.test.ts#L354) | −39 h | None | 38 h | h-another | Replay error code `INVALID_ACCESS`; session unchanged by replay; committed count 1; available slots 1. | Replay error code `INVALID_ACCESS`; session unchanged by replay; committed count 1; available slots 1. |

## promoteFromWaitlist — eligibility and queue selection

**Input:** Loaded user, Email verified, Committed users, Waitlist, Hold ID, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Loaded user | Email verified | Committed users | Waitlist | Hold ID | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [alice](promotion.test.ts#L15) | No | None | alice, ben | h-alice | 48 h | Result `PROMOTED`; exactly one instruction; alice `COMMITTED`; next waiter ben; committed count 1. | Result `PROMOTED`; exactly one instruction; alice `COMMITTED`; next waiter ben; committed count 1. |
| [alice](promotion.test.ts#L40) | Yes | None | None | Empty string | 48 h | Exact result: `NONE`, empty instructions; session unchanged. | Exact result: `NONE`, empty instructions; session unchanged. |
| [alice](promotion.test.ts#L55) | Yes | None | None | Empty string | 0 h | Error code `SESSION_STARTED`, message “The session has started”; session unchanged. | Error code `SESSION_STARTED`, message “The session has started”; session unchanged. |
| [other](promotion.test.ts#L76) | Yes | ben; alice withdrew OPEN_SLOT at −48 h and was REFUNDED | cara | h-cara | 48 h | Error code `INVALID_INPUT`; session unchanged. | Error code `INVALID_INPUT`; session unchanged. |

## promoteFromWaitlist — FIFO and loaded funds

All operations occur 48 hours before start; queue entries have the same timestamp and are ordered by their sequence numbers.

**Input:** Loaded user, Available funds (cents), Committed users, Waitlist / previous entry, Hold ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Loaded user | Available funds (cents) | Committed users | Waitlist / previous entry | Hold ID | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [cara](promotion.test.ts#L107) | 500 at waitlist entry; 700 after reload | alice and ben at join; alice then withdraws at −48 h | cara joins full session before alice withdraws | h-cara | Initial admission `WAITLISTED`; promotion `PROMOTED`; first instruction wallet `w-cara`; wallet at entry remains 500 cents, reloaded wallet remains 700 cents. | Initial admission `WAITLISTED`; promotion `PROMOTED`; first instruction wallet `w-cara`; wallet at entry remains 500 cents, reloaded wallet remains 700 cents. |
| [cara](promotion.test.ts#L149) | 500 at waitlist entry; 0 after reload | alice and ben at join; alice then withdraws at −48 h | cara joins full session before alice withdraws | h-cara | Exact result: `SKIPPED`, participation `p-cara`, reason `INSUFFICIENT_FUNDS`, empty instructions; cara `LEFT_WAITLIST`; available slots 1. | Exact result: `SKIPPED`, participation `p-cara`, reason `INSUFFICIENT_FUNDS`, empty instructions; cara `LEFT_WAITLIST`; available slots 1. |
| [cara](promotion.test.ts#L184) | 0 | ben | cara, dana, evan | h-cara | Exact result: `SKIPPED`, participation `p-cara`, reason `INSUFFICIENT_FUNDS`, empty instructions; cara `LEFT_WAITLIST`; next waiter dana; next sequence stays 4; available slots 1. | Exact result: `SKIPPED`, participation `p-cara`, reason `INSUFFICIENT_FUNDS`, empty instructions; cara `LEFT_WAITLIST`; next waiter dana; next sequence stays 4; available slots 1. |
| [dana](promotion.test.ts#L219) | 500 | ben | cara LEFT_WAITLIST at 1; dana at 2; evan at 3 | h-dana | Result `PROMOTED`, participation `p-dana`; exactly one instruction with kind `LOCK`, participation `p-dana`, hold `h-dana`, amount 500 cents; dana `COMMITTED`; next waiter evan. | Result `PROMOTED`, participation `p-dana`; exactly one instruction with kind `LOCK`, participation `p-dana`, hold `h-dana`, amount 500 cents; dana `COMMITTED`; next waiter evan. |

## promoteFromWaitlist — reserved vacancies

**Input:** Loaded user, Committed users, Reserved withdrawal, Waitlist, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Loaded user | Committed users | Reserved withdrawal | Waitlist | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [cara](promotion.test.ts#L258) | alice | ben at −10 h; DIRECT_INVITE to cara | cara, dana | 9 h | Error code `INVALID_STATE`; session unchanged; cara `WAITLISTED` and still next; reservation still targets `p-ben`; committed count 1; available slots 0; next sequence stays 3. | Error code `INVALID_STATE`; session unchanged; cara `WAITLISTED` and still next; reservation still targets `p-ben`; committed count 1; available slots 0; next sequence stays 3. |
| [dana](promotion.test.ts#L303) | alice | ben at −10 h; DIRECT_INVITE to cara | dana, evan | 9 h | Error code `CAPACITY_EXCEEDED`; session unchanged; next waiter dana. | Error code `CAPACITY_EXCEEDED`; session unchanged; next waiter dana. |

## promoteFromWaitlist — replacement refunds

Withdrawal holds begin `AWAITING_REPLACEMENT`. Result and instruction descriptions preserve partial-object assertions: only stated fields are constrained.

**Input:** Loaded user / hold ID, Committed users, Withdrawals, Waitlist, Time before start, Refund failure · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Loaded user / hold ID | Committed users | Withdrawals | Waitlist | Time before start | Refund failure | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [dana / h-dana](promotion.test.ts#L335) | None | ben: −10 h, DIRECT_INVITE to cara; alice: −9 h, OPEN_SLOT | dana, evan | 8 h | None | Result `PROMOTED`, refunded participation `p-alice`; instruction kinds `[LOCK, REFUND]`; dana replaces `p-alice`; ben hold `AWAITING_REPLACEMENT`; next waiter evan; available slots 0. | Result `PROMOTED`, refunded participation `p-alice`; instruction kinds `[LOCK, REFUND]`; dana replaces `p-alice`; ben hold `AWAITING_REPLACEMENT`; next waiter evan; available slots 0. |
| [first-waiter / h-promoted](promotion.test.ts#L383) | ben | alice: −2 h, OPEN_SLOT | first-waiter, second-waiter | 1 h | INVALID_STATE: Replacement refund failed | Error code `INVALID_STATE`: “Replacement refund failed”; session unchanged; next waiter first-waiter. | Error code `INVALID_STATE`: “Replacement refund failed”; session unchanged; next waiter first-waiter. |
| [dana / h-dana](promotion.test.ts#L432) | alex | ben: −10 h, OPEN_SLOT | dana, evan | 8 h | None | Result fields: `PROMOTED`, participation `p-dana`, refunded `p-ben`; exactly two instructions: LOCK p-dana/h-dana then REFUND p-ben/h-ben, each 500 cents; ben hold `REFUNDED`, dana hold `HELD`; dana replaces `p-ben`; next waiter evan; next sequence stays 3. | Result fields: `PROMOTED`, participation `p-dana`, refunded `p-ben`; exactly two instructions: LOCK p-dana/h-dana then REFUND p-ben/h-ben, each 500 cents; ben hold `REFUNDED`, dana hold `HELD`; dana replaces `p-ben`; next waiter evan; next sequence stays 3. |
| [dana / h-dana](promotion.test.ts#L492) | None | ben: −10 h, OPEN_SLOT; alice: −9 h, OPEN_SLOT | dana | 7 h | None | Result fields: `PROMOTED`, refunded `p-ben`; exactly two instruction entries with LOCK/p-dana then REFUND/p-ben; ben withdrawal stays −10 h, hold `REFUNDED`; alice withdrawal stays −9 h, hold `AWAITING_REPLACEMENT`; dana replaces `p-ben`. | Result fields: `PROMOTED`, refunded `p-ben`; exactly two instruction entries with LOCK/p-dana then REFUND/p-ben; ben withdrawal stays −10 h, hold `REFUNDED`; alice withdrawal stays −9 h, hold `AWAITING_REPLACEMENT`; dana replaces `p-ben`. |

## leaveWaitlist — leave an existing entry

**Input:** Actor, Email, Target participation, Committed users, Waitlist · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Actor | Email | Target participation | Committed users | Waitlist | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [alice](waitlist.test.ts#L11) | Absent | p-alice | None | alice | alice `LEFT_WAITLIST`; next waiter absent. | alice `LEFT_WAITLIST`; next waiter absent. |
| [waiting](waitlist.test.ts#L68) | Present, verified | p-waiting | alice, ben | waiting | Roster statuses `[COMMITTED, COMMITTED, LEFT_WAITLIST]`; next waiter absent; available slots 0. | Roster statuses `[COMMITTED, COMMITTED, LEFT_WAITLIST]`; next waiter absent; available slots 0. |
| [other](waitlist.test.ts#L96) | Present, verified | p-waiting | alice, ben | waiting | Error code `UNAUTHORIZED`; session unchanged. | Error code `UNAUTHORIZED`; session unchanged. |
| [alice](waitlist.test.ts#L114) | Present, verified | p-alice | alice | None | Error code `INVALID_STATE`; session unchanged. | Error code `INVALID_STATE`; session unchanged. |

## withdraw — refund cutoff

Each participant owns the sole committed entry and its 500-cent held share. The command supplies their participation ID; replacement mode and invitee are omitted. The refund cutoff is 30 hours before start.

**Input:** Participant, Email verified, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **5 passed / 5 cases**.

| Participant | Email verified | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [participant](withdrawals.test.ts#L13) | Yes | 31 h | Result `REFUNDED`; participation belongs to `participant`, status `WITHDRAWN`, hold `REFUNDED`; exactly one instruction with kind `REFUND`, participation `p-participant`, hold `h-participant`, wallet `w-participant`, amount 500 cents. | Result `REFUNDED`; participation belongs to `participant`, status `WITHDRAWN`, hold `REFUNDED`; exactly one instruction with kind `REFUND`, participation `p-participant`, hold `h-participant`, wallet `w-participant`, amount 500 cents. |
| [alice](withdrawals.test.ts#L42) | No | 48 h | Result `REFUNDED`; first instruction kind `REFUND`, amount 500 cents; alice `WITHDRAWN`. | Result `REFUNDED`; first instruction kind `REFUND`, amount 500 cents; alice `WITHDRAWN`. |
| [alice](withdrawals.test.ts#L62) | Yes | 30 h + 1 ms | Result `REFUNDED`; hold `REFUNDED`. | Result `REFUNDED`; hold `REFUNDED`. |
| [alice](withdrawals.test.ts#L83) | Yes | 30 h | Result `REFUNDED`; hold `REFUNDED`. | Result `REFUNDED`; hold `REFUNDED`. |
| [alice](withdrawals.test.ts#L101) | Yes | 29 h 59 min 59 s | Result `AWAITING_REPLACEMENT`; hold `AWAITING_REPLACEMENT`. | Result `AWAITING_REPLACEMENT`; hold `AWAITING_REPLACEMENT`. |

## withdraw — invite a replacement

All commands request `DIRECT_INVITE`. The withdrawing participant starts committed with a 500-cent held share; other reservations appear explicitly.

**Input:** Participant, Other committed users, Waitlist, Named invitee / existing reservation, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **7 passed / 7 cases**.

| Participant | Other committed users | Waitlist | Named invitee / existing reservation | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [ben](withdrawals.test.ts#L120) | alex | None | cara; no reservation | 10 h | Result `AWAITING_REPLACEMENT`; instructions empty; no cara participation; ben hold `AWAITING_REPLACEMENT`; cara reservation targets `p-ben`; committed count 1, reserved count 1, available slots 0. | Result `AWAITING_REPLACEMENT`; instructions empty; no cara participation; ben hold `AWAITING_REPLACEMENT`; cara reservation targets `p-ben`; committed count 1, reserved count 1, available slots 0. |
| [ben](withdrawals.test.ts#L153) | alex | dana, cara | cara; no reservation | 10 h | Instructions empty; cara retains the same waitlist object (`WAITLISTED`, no hold, position 2); next waiter dana; next sequence stays 3; reserved count 1. | Instructions empty; cara retains the same waitlist object (`WAITLISTED`, no hold, position 2); next waiter dana; next sequence stays 3; reserved count 1. |
| [alice](withdrawals.test.ts#L187) | ben | None | cara; no reservation | 40 h | Result `REFUNDED`; instruction kinds `[REFUND]`; alice replacement mode `DIRECT_INVITE`, invitee cara, hold `REFUNDED`; available slots 0. | Result `REFUNDED`; instruction kinds `[REFUND]`; alice replacement mode `DIRECT_INVITE`, invitee cara, hold `REFUNDED`; available slots 0. |
| [alice](withdrawals.test.ts#L214) | None | None | Omitted | 40 h | Error code `INVALID_INPUT`; session unchanged. | Error code `INVALID_INPUT`; session unchanged. |
| [alice](withdrawals.test.ts#L231) | None | None | alice; self | 10 h | Error code `INVALID_INPUT`; session unchanged. | Error code `INVALID_INPUT`; session unchanged. |
| [alice](withdrawals.test.ts#L249) | ben | None | ben; already committed | 10 h | Error code `INVALID_STATE`; session unchanged. | Error code `INVALID_STATE`; session unchanged. |
| [ben](withdrawals.test.ts#L269) | None | None | cara; alice reserved at −10 h, AWAITING_REPLACEMENT hold | 9 h | Error code `DUPLICATE_ID`; session unchanged. | Error code `DUPLICATE_ID`; session unchanged. |

## withdraw — reject changes to a replacement choice

The participant already withdrew at −10 h and has an `AWAITING_REPLACEMENT` hold. Each second command reuses their participation ID.

**Input:** Participant, Other committed users, Waitlist, Existing choice at −10 h, Requested choice at −9 h · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Participant | Other committed users | Waitlist | Existing choice at −10 h | Requested choice at −9 h | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [alice](withdrawals.test.ts#L301) | ben | dana | DIRECT_INVITE to cara | OPEN_SLOT | Error code `INVALID_STATE`; session unchanged; alice choice `DIRECT_INVITE` to cara; available slots 0; next waiter dana. | Error code `INVALID_STATE`; session unchanged; alice choice `DIRECT_INVITE` to cara; available slots 0; next waiter dana. |
| [alice](withdrawals.test.ts#L339) | ben | dana | OPEN_SLOT | DIRECT_INVITE to cara | Error code `INVALID_STATE`; session unchanged; alice choice `OPEN_SLOT`, invitee absent; available slots 1; next waiter dana. | Error code `INVALID_STATE`; session unchanged; alice choice `OPEN_SLOT`, invitee absent; available slots 1; next waiter dana. |
| [ben](withdrawals.test.ts#L377) | alex | None | DIRECT_INVITE to cara | DIRECT_INVITE to dana | Error code `INVALID_STATE`; session unchanged; cara invitation remains addressed to cara; no dana reservation; reserved count 1; available slots 0. | Error code `INVALID_STATE`; session unchanged; cara invitation remains addressed to cara; no dana reservation; reserved count 1; available slots 0. |

## withdraw — ownership and start-time guards

alice is the sole committed participant; replacement mode and invitee are omitted.

**Input:** Actor, Participation, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Actor | Participation | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [other](withdrawals.test.ts#L417) | p-alice | 48 h | Error code `UNAUTHORIZED`; session unchanged. | Error code `UNAUTHORIZED`; session unchanged. |
| [alice](withdrawals.test.ts#L434) | p-alice | 0 h | Error code `SESSION_STARTED`; session unchanged. | Error code `SESSION_STARTED`; session unchanged. |

## previewWithdrawal — inspect an outcome

**Input:** Actor, Existing participation, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **5 passed / 5 cases**.

| Actor | Existing participation | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [alice](withdrawals.test.ts#L453) | alice COMMITTED, 500-cent HELD hold | 31 h | Preview `REFUNDED`, participation `p-alice`, refund 500 cents, held amount 500 cents; session unchanged. | Preview `REFUNDED`, participation `p-alice`, refund 500 cents, held amount 500 cents; session unchanged. |
| [alice](withdrawals.test.ts#L468) | alice COMMITTED, 500-cent HELD hold | 30 h | Preview `AWAITING_REPLACEMENT`, refund 0 cents, held amount 500 cents; session unchanged. | Preview `AWAITING_REPLACEMENT`, refund 0 cents, held amount 500 cents; session unchanged. |
| [other](withdrawals.test.ts#L501) | alice COMMITTED; no other entry | 40 h | Error code `NOT_FOUND`. | Error code `NOT_FOUND`. |
| [alice](withdrawals.test.ts#L511) | alice WITHDRAWN at −10 h, OPEN_SLOT, AWAITING_REPLACEMENT; ben COMMITTED | 9 h | Error code `INVALID_STATE`. | Error code `INVALID_STATE`. |
| [alice](withdrawals.test.ts#L529) | alice COMMITTED, 500-cent HELD hold | 0 h | Error code `SESSION_STARTED`. | Error code `SESSION_STARTED`. |

## previewWithdrawal then withdraw — compare outcomes

alice is the sole committed participant. The comparison asserts consistency between the two calls rather than an independently fixed refund value.

**Input:** Participant, Starting hold (cents), Preview time before start, Withdrawal time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Participant | Starting hold (cents) | Preview time before start | Withdrawal time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [alice](withdrawals.test.ts#L482) | 500; HELD | 40 h | 40 h | Withdrawal kind equals preview kind; the withdrawal’s instruction-amount list contains exactly the preview refund amount. No fixed kind or amount is asserted. | Withdrawal kind equals preview kind; the withdrawal’s instruction-amount list contains exactly the preview refund amount. No fixed kind or amount is asserted. |

## withdraw — forfeit a late place

A late withdrawal may give the share to the booker and close the place instead of passing it on ([ADR-0024](../../../../docs/adr/0024-late-withdrawal-forfeit.md)). Default session of three places (the booker's own and two guest places).

**Input:** Participant, Committed users, Replacement choice, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Participant | Committed users | Replacement choice | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [alice](withdrawals.test.ts#L541) | alice | FORFEIT | 10 h | Result `FORFEITURE_DUE`; instructions empty; alice `WITHDRAWN`, replacement mode `FORFEIT`, hold `FORFEITURE_DUE`, 500 cents. | Result `FORFEITURE_DUE`; instructions empty; alice `WITHDRAWN`, replacement mode `FORFEIT`, hold `FORFEITURE_DUE`, 500 cents. |
| [alice](withdrawals.test.ts#L562) | alice, ben | FORFEIT | 10 h | Available slots 0; no withdrawal awaits a replacement. | Available slots 0; no withdrawal awaits a replacement. |
| [alice](withdrawals.test.ts#L580) | alice | FORFEIT | 30 h | Error code `INVALID_STATE`; session unchanged. | Error code `INVALID_STATE`; session unchanged. |
| [alice](withdrawals.test.ts#L595) | alice | FORFEIT, naming cara | 10 h | Error code `INVALID_INPUT`; session unchanged. | Error code `INVALID_INPUT`; session unchanged. |

## join — a forfeited place stays closed

**Input:** Applicant, Total places, Withdrawals, Time before start · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Applicant | Total places | Withdrawals | Time before start | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [cara](admission.test.ts#L782) | 2 (booker and one guest) | ben: −10 h, FORFEIT, hold `FORFEITURE_DUE` | 5 h | Admission `WAITLISTED`; cara hold absent. | Admission `WAITLISTED`; cara hold absent. |
