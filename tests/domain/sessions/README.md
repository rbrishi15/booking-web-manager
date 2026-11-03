# Sessions test cases

Snapshot: **2026-10-24, payout refactor** · **85 cases, 85 passed**. See the [domain testing guide](../README.md) and [execution evidence](../results/README.md).

Each row is one independently executable test; its first input value links to the test definition. **Test Result** contains assertion-verified observations derived from executed assertions and their recorded status, not captured runtime payloads. Expected Result is the **Oracle**; Test Result is the **Log**. A matching result reports only the stated assertions, including partial matches, identity and unchanged-state checks. Refresh the snapshot after relevant source changes.

## Booking terms and schedule

Source: [booking.test.ts](booking.test.ts). Defaults: venue Court, region North, sport Badminton, cost 100 cents, start 2026-10-01 00:00 UTC, end 2026-10-02 00:00 UTC. Dates below are UTC.

### Construct booking — required terms

**Input:** Cost (cents), Venue · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Cost (cents) | Venue | Expected Result | Test Result |
| --- | --- | --- | --- |
| [0](booking.test.ts#L15) | Court | RangeError | RangeError |
| [100](booking.test.ts#L21) | one space | RangeError | RangeError |

### Construct booking — schedule validation

**Input:** Start date, End date · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Start date | End date | Expected Result | Test Result |
| --- | --- | --- | --- |
| [2026-10-02](booking.test.ts#L29) | 2026-10-02 | RangeError | RangeError |
| [2026-10-01](booking.test.ts#L35) | Invalid date | RangeError | RangeError |

### Construct booking — date isolation

**Input:** Start date, End date, Source start year after construction, Returned start/end years after construction · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Start date | End date | Source start year after construction | Returned start/end years after construction | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [2026-10-01](booking.test.ts#L41) | 2026-10-02 | 2000 | 2001 / 2002 | Start 2026-10-01; end 2026-10-02 | Start 2026-10-01; end 2026-10-02 |

### Check whether booking has started

**Input:** Current time (UTC) · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Current time (UTC) | Expected Result | Test Result |
| --- | --- | --- |
| [2026-10-01 00:00](booking.test.ts#L53) | true | true |

### Check whether booking has ended

**Input:** Current time (UTC) · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Current time (UTC) | Expected Result | Test Result |
| --- | --- | --- |
| [2026-10-02 00:00](booking.test.ts#L61) | true | true |

### Compare booking values

All remaining booking values are identical.

**Input:** First venue, Second venue · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| First venue | Second venue | Expected Result | Test Result |
| --- | --- | --- | --- |
| [Court](booking.test.ts#L71) | Court | true | true |
| [Court](booking.test.ts#L80) | Other | false | false |

## Fund hold state and settlement metadata

Source: [fund-hold.test.ts](fund-hold.test.ts). Defaults: hold hold, participation participation, holding account platform, wallet wallet, amount 500 cents, state HELD, created 2026-10-01 00:00 UTC. No settlement date or payout unless shown. Dates below are UTC.

### Restore active hold — date isolation

**Input:** Hold state, Amount (cents), Created date, Source/returned date after construction · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Hold state | Amount (cents) | Created date | Source/returned date after construction | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [HELD](fund-hold.test.ts#L9) | 500 | 2026-10-01 | 1970-01-01 | HELD; 500 cents; created 2026-10-01 | HELD; 500 cents; created 2026-10-01 |
| [AWAITING_REPLACEMENT](fund-hold.test.ts#L21) | 500 | 2026-10-01 | 1970-01-01 | AWAITING_REPLACEMENT; 500 cents; created 2026-10-01 | AWAITING_REPLACEMENT; 500 cents; created 2026-10-01 |
| [FORFEITURE_DUE](fund-hold.test.ts#L33) | 500 | 2026-10-01 | 1970-01-01 | FORFEITURE_DUE; 500 cents; created 2026-10-01 | FORFEITURE_DUE; 500 cents; created 2026-10-01 |

### Restore active hold — metadata validation

**Input:** Hold state, Amount (cents), Created date, Settled date, Payout ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **5 passed / 5 cases**.

| Hold state | Amount (cents) | Created date | Settled date | Payout ID | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [HELD](fund-hold.test.ts#L45) | 500 | 2026-10-01 | 2026-10-03 | Absent | DomainError | DomainError |
| [HELD](fund-hold.test.ts#L51) | 500 | 2026-10-01 | Absent | payout | DomainError | DomainError |
| [HELD](fund-hold.test.ts#L57) | 0 | 2026-10-01 | Absent | Absent | DomainError | DomainError |
| [UNKNOWN](fund-hold.test.ts#L63) | 500 | 2026-10-01 | Absent | Absent | DomainError | DomainError |
| [HELD](fund-hold.test.ts#L71) | 500 | Invalid date | Absent | Absent | RangeError | RangeError |

### Restore completed hold — settlement date isolation

**Input:** Hold state, Settled date, Payout ID, Source/returned settled date after construction · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Hold state | Settled date | Payout ID | Source/returned settled date after construction | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [REFUNDED](fund-hold.test.ts#L79) | 2026-10-03 | Absent | 1970-01-01 | REFUNDED; settled 2026-10-03; payout absent | REFUNDED; settled 2026-10-03; payout absent |
| [RELEASED](fund-hold.test.ts#L96) | 2026-10-03 | payout | 1970-01-01 | RELEASED; settled 2026-10-03; payout payout | RELEASED; settled 2026-10-03; payout payout |
| [FORFEITED](fund-hold.test.ts#L113) | 2026-10-03 | payout | 1970-01-01 | FORFEITED; settled 2026-10-03; payout payout | FORFEITED; settled 2026-10-03; payout payout |

### Restore completed hold — metadata validation

**Input:** Hold state, Settled date, Payout ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Hold state | Settled date | Payout ID | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [RELEASED](fund-hold.test.ts#L130) | Absent | Absent | DomainError | DomainError |
| [RELEASED](fund-hold.test.ts#L136) | 2026-10-03 | Absent | DomainError | DomainError |
| [FORFEITED](fund-hold.test.ts#L142) | 2026-10-03 | one space | DomainError | DomainError |
| [REFUNDED](fund-hold.test.ts#L152) | 2026-10-03 | payout | DomainError | DomainError |

### Refund an already settled hold

All holds were settled on 2026-10-03.

**Input:** Hold state, Payout ID, Refund date · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Hold state | Payout ID | Refund date | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [REFUNDED](fund-hold.test.ts#L164) | Absent | 2026-10-03 | DomainError | DomainError |
| [RELEASED](fund-hold.test.ts#L172) | payout | 2026-10-03 | DomainError | DomainError |
| [FORFEITED](fund-hold.test.ts#L180) | payout | 2026-10-03 | DomainError | DomainError |

## Participant roster isolation and queue ordering

Source: [participant-list.test.ts](participant-list.test.ts). Session defaults: session s, booker booker, two slots, total cost 1,000 cents, share 500 cents, holding account platform, start 2026-10-10 10:00 UTC and end two hours later. Participant IDs are p- followed by the user ID; committed holds are 500 cents, created 48 hours before start. Waiters joined 48 hours before start. Times below are hours before start.

### Read participations and look up participants

**Input:** Committed users in roster order, Source array edits, Returned array edits · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Committed users in roster order | Source array edits | Returned array edits | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [alice, ben](participant-list.test.ts#L11) | Reverse, remove last | Remove last, reverse | Roster alice, ben; ID and user lookups retain each original instance; committed count 2; next queue sequence 1 | Roster alice, ben; ID and user lookups retain each original instance; committed count 2; next queue sequence 1 |

### Find next waitlisted participant

**Input:** Roster order, Queue sequences (same order), Next queue sequence · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Roster order | Queue sequences (same order) | Next queue sequence | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [alice, ben, cara](participant-list.test.ts#L36) | 3, 1, 2 | 4 | ben, same instance as roster and user lookup; roster order unchanged; committed count 0; next queue sequence 4 | ben, same instance as roster and user lookup; roster order unchanged; committed count 0; next queue sequence 4 |

### Find oldest open replacement and named reservations

**Input:** Roster order, Hold states (same order), Withdrawal times (hours before start), Replacement modes (same order), Named invitee · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Roster order | Hold states (same order) | Withdrawal times (hours before start) | Replacement modes (same order) | Named invitee | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [cara, ben, alice](participant-list.test.ts#L72) | REFUNDED, AWAITING_REPLACEMENT, AWAITING_REPLACEMENT | 48, 10, 10 | None, OPEN_SLOT, OPEN_SLOT | None | ben, original instance and same user lookup; roster cara, ben, alice; committed count 0; no next waiter | ben, original instance and same user lookup; roster cara, ben, alice; committed count 0; no next waiter |
| [alice, ben](participant-list.test.ts#L109) | AWAITING_REPLACEMENT, AWAITING_REPLACEMENT | 10, 9 | DIRECT_INVITE, OPEN_SLOT | alice invites cara | ben, original instance; reserved count 1; cara reservation is original alice instance | ben, original instance; reserved count 1; cara reservation is original alice instance |

## Participation state and fund lifecycle

Source: [participation.test.ts](participation.test.ts). Defaults: participation participation, user user, status COMMITTED, attendance UNVERIFIED, committed 2026-10-01 00:00 UTC; hold hold belongs to participation, uses platform/wallet, holds 500 cents and was created at commitment. Unspecified metadata is absent. Dates below are UTC; transition date is 2026-10-03 unless shown.

### Restore participation — date and hold identity

**Input:** Committed date, Source/returned committed date after construction · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Committed date | Source/returned committed date after construction | Expected Result | Test Result |
| --- | --- | --- | --- |
| [2026-10-01](participation.test.ts#L16) | 1970-01-01 | Committed date 2026-10-01; hold is the original input instance | Committed date 2026-10-01; hold is the original input instance |

### Restore participation — commitment and queue validation

**Input:** Participation state, Hold owner, Committed date, Waitlisted date, Queue sequence · **Oracle:** Expected Result · **Log:** Test Result

Execution: **6 passed / 6 cases**.

| Participation state | Hold owner | Committed date | Waitlisted date | Queue sequence | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [COMMITTED](participation.test.ts#L27) | foreign | 2026-10-01 | Absent | Absent | DomainError | DomainError |
| [COMMITTED](participation.test.ts#L35) | No hold | 2026-10-01 | Absent | Absent | DomainError | DomainError |
| [COMMITTED](participation.test.ts#L41) | participation | Absent | Absent | Absent | DomainError | DomainError |
| [WAITLISTED](participation.test.ts#L47) | No hold | 2026-10-01 | Absent | Absent | DomainError | DomainError |
| [WAITLISTED](participation.test.ts#L56) | participation | 2026-10-01 | 2026-10-01 | 1 | DomainError | DomainError |
| [COMMITTED](participation.test.ts#L66) | participation | 2026-10-01 | Absent | 0 | DomainError | DomainError |

### Commit queued replacement

The original entry was waitlisted on 2026-10-01.

**Input:** Participation state, Queue sequence, Commit date, Hold (cents), Replaced participation ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Participation state | Queue sequence | Commit date | Hold (cents) | Replaced participation ID | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [WAITLISTED](participation.test.ts#L72) | 1 | 2026-10-01 | 500 | previous | Returned participation replaces previous; original remains WAITLISTED with no hold | Returned participation replaces previous; original remains WAITLISTED with no hold |

### Restore participation — withdrawal and replacement metadata

**Input:** Participation state, Hold state, Withdrawn date, Replaced participation ID, Replacement mode, Invitee · **Oracle:** Expected Result · **Log:** Test Result

Execution: **8 passed / 8 cases**.

| Participation state | Hold state | Withdrawn date | Replaced participation ID | Replacement mode | Invitee | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [WITHDRAWN](participation.test.ts#L109) | HELD | 2026-10-03 | Absent | Absent | Absent | DomainError | DomainError |
| [COMMITTED](participation.test.ts#L118) | HELD | Absent | participation | Absent | Absent | DomainError | DomainError |
| [COMMITTED](participation.test.ts#L126) | HELD | Absent | Absent | DIRECT_INVITE | ben | DomainError | DomainError |
| [WITHDRAWN](participation.test.ts#L135) | AWAITING_REPLACEMENT | 2026-10-03 | Absent | DIRECT_INVITE | Absent | INVALID_INPUT | INVALID_INPUT |
| [WITHDRAWN](participation.test.ts#L148) | AWAITING_REPLACEMENT | 2026-10-03 | Absent | DIRECT_INVITE | one space | INVALID_INPUT | INVALID_INPUT |
| [WITHDRAWN](participation.test.ts#L162) | AWAITING_REPLACEMENT | 2026-10-03 | Absent | DIRECT_INVITE | user | INVALID_INPUT | INVALID_INPUT |
| [WITHDRAWN](participation.test.ts#L176) | AWAITING_REPLACEMENT | 2026-10-03 | Absent | OPEN_SLOT | ben | INVALID_INPUT | INVALID_INPUT |
| [WITHDRAWN](participation.test.ts#L190) | AWAITING_REPLACEMENT | 2026-10-03 | Absent | Absent | ben | INVALID_INPUT | INVALID_INPUT |

### Withdraw committed participation

**Input:** Participation state, Replaced participation ID, New hold state, Replacement mode, Invitee · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Participation state | Replaced participation ID | New hold state | Replacement mode | Invitee | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [COMMITTED](participation.test.ts#L203) | Absent | REFUNDED | DIRECT_INVITE | ben | WITHDRAWN; REFUNDED; DIRECT_INVITE to ben; original COMMITTED with no invitee | WITHDRAWN; REFUNDED; DIRECT_INVITE to ben; original COMMITTED with no invitee |
| [COMMITTED](participation.test.ts#L224) | Absent | AWAITING_REPLACEMENT | DIRECT_INVITE | ben | WITHDRAWN; AWAITING_REPLACEMENT; invitee ben; original hold HELD | WITHDRAWN; AWAITING_REPLACEMENT; invitee ben; original hold HELD |
| [COMMITTED](participation.test.ts#L93) | original-participation | AWAITING_REPLACEMENT | OPEN_SLOT | Absent | WITHDRAWN; replaces original-participation; AWAITING_REPLACEMENT; original COMMITTED | WITHDRAWN; replaces original-participation; AWAITING_REPLACEMENT; original COMMITTED |

### Withdraw again — reject changing departure choice

Both inputs are already WITHDRAWN on 2026-10-03; the existing hold is supplied again.

**Input:** Existing replacement mode, Existing invitee, Existing hold state, Requested replacement mode, Requested invitee · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Existing replacement mode | Existing invitee | Existing hold state | Requested replacement mode | Requested invitee | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [DIRECT_INVITE](participation.test.ts#L243) | ben | REFUNDED | OPEN_SLOT | Absent | INVALID_STATE; DIRECT_INVITE to ben and REFUNDED unchanged | INVALID_STATE; DIRECT_INVITE to ben and REFUNDED unchanged |
| [OPEN_SLOT](participation.test.ts#L262) | Absent | AWAITING_REPLACEMENT | DIRECT_INVITE | ben | INVALID_STATE; OPEN_SLOT, no invitee and AWAITING_REPLACEMENT unchanged | INVALID_STATE; OPEN_SLOT, no invitee and AWAITING_REPLACEMENT unchanged |

### Refund a found replacement

**Input:** Withdrawal date, Replacement mode, Invitee, Refund date · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Withdrawal date | Replacement mode | Invitee | Refund date | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [2026-10-01](participation.test.ts#L280) | DIRECT_INVITE | ben | 2026-10-03 | Original COMMITTED / HELD; withdrawn hold AWAITING_REPLACEMENT; finalized hold REFUNDED with invitee ben | Original COMMITTED / HELD; withdrawn hold AWAITING_REPLACEMENT; finalized hold REFUNDED with invitee ben |

### Restore cancelled or removed participation

**Input:** Participation state, Hold state · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Participation state | Hold state | Expected Result | Test Result |
| --- | --- | --- | --- |
| [CANCELLED](participation.test.ts#L332) | HELD | DomainError | DomainError |
| [REMOVED](participation.test.ts#L338) | HELD | DomainError | DomainError |

### Cancel a participation

The withdrawn input has an AWAITING_REPLACEMENT hold and withdrawal date 2026-10-01. Supplied refunds settled on 2026-10-03.

**Input:** Participation state, Replaced participation ID, Existing replacement mode, Invitee, New hold state · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Participation state | Replaced participation ID | Existing replacement mode | Invitee | New hold state | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [WITHDRAWN](participation.test.ts#L344) | Absent | DIRECT_INVITE | ben | REFUNDED | CANCELLED; replacement mode and invitee absent; original invitee ben | CANCELLED; replacement mode and invitee absent; original invitee ben |
| [COMMITTED](participation.test.ts#L316) | original-participation | Absent | Absent | REFUNDED | CANCELLED; replaces original-participation; REFUNDED; original COMMITTED | CANCELLED; replaces original-participation; REFUNDED; original COMMITTED |

### Remove an accepted replacement

The supplied refund settled on 2026-10-03.

**Input:** Participation state, Replaced participation ID, New hold state · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Participation state | Replaced participation ID | New hold state | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [COMMITTED](participation.test.ts#L300) | original-participation | REFUNDED | REMOVED; replaces original-participation; REFUNDED; original COMMITTED | REMOVED; replaces original-participation; REFUNDED; original COMMITTED |

### Restore participation — attendance verification metadata

**Input:** Attendance, Verification method, Verified date · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Attendance | Verification method | Verified date | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [ATTENDED](participation.test.ts#L368) | Absent | Absent | DomainError | DomainError |
| [UNVERIFIED](participation.test.ts#L374) | BOOKER | 2026-10-03 | DomainError | DomainError |

### Settle a participation hold

ATTENDED inputs were verified by BOOKER on 2026-10-03; withdrawn input left on 2026-10-01. Settlement is requested on 2026-10-03.

**Input:** Participation state, Attendance, Hold state, Settlement kind, Payout ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Participation state | Attendance | Hold state | Settlement kind | Payout ID | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [COMMITTED](participation.test.ts#L383) | UNVERIFIED | HELD | RELEASE | payout | DomainError | DomainError |
| [COMMITTED](participation.test.ts#L391) | ATTENDED | HELD | RELEASE | payout | New hold RELEASED; original hold HELD | New hold RELEASED; original hold HELD |
| [COMMITTED](participation.test.ts#L406) | ATTENDED | HELD | FORFEIT | payout | DomainError | DomainError |
| [WITHDRAWN](participation.test.ts#L441) | UNVERIFIED | FORFEITURE_DUE | FORFEIT | payout | Different participation instance; original hold FORFEITURE_DUE; finalized hold FORFEITED with payout payout | Different participation instance; original hold FORFEITURE_DUE; finalized hold FORFEITED with payout payout |

### Expire an awaited replacement

**Input:** Hold state, Withdrawn date, Replacement mode, Invitee, Expiry date · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Hold state | Withdrawn date | Replacement mode | Invitee | Expiry date | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [AWAITING_REPLACEMENT](participation.test.ts#L422) | 2026-10-01 | DIRECT_INVITE | ben | 2026-10-03 | Different participation instance; new hold FORFEITURE_DUE; invitee ben; original hold AWAITING_REPLACEMENT | Different participation instance; new hold FORFEITURE_DUE; invitee ben; original hold AWAITING_REPLACEMENT |

### Read reliability outcome

Withdrawal was on 2026-10-01.

**Input:** Participation state, Hold state, Payout ID, Settled date, Observation date · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Participation state | Hold state | Payout ID | Settled date | Observation date | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [WITHDRAWN](participation.test.ts#L458) | FORFEITED | payout | 2026-10-03 | 2026-10-03 | 0 | 0 |

### Forfeited places

A forfeit withdrawal keeps its share due to the booker ([ADR-0024](../../../docs/adr/0024-late-withdrawal-forfeit.md)).

**Input:** Participation state, Hold state, Withdrawn date, Replacement mode · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| Participation state | Hold state | Withdrawn date | Replacement mode | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [WITHDRAWN](participation.test.ts#L476) | AWAITING_REPLACEMENT | 2026-10-03 | FORFEIT | INVALID_INPUT | INVALID_INPUT |
| [WITHDRAWN](participation.test.ts#L489) | FORFEITURE_DUE | 2026-10-03 | FORFEIT | Replacement mode `FORFEIT`; hold `FORFEITURE_DUE` | Replacement mode `FORFEIT`; hold `FORFEITURE_DUE` |

## Session pricing

Source: [pricing.test.ts](pricing.test.ts). All prices and costs are integer cents. Successful price-bound results give suggested / minimum / maximum and also verify maximum × slots ≤ 9,007,199,254,740,991 cents.

### Calculate price bounds

**Input:** Booking cost (cents), Slots · **Oracle:** Expected Result · **Log:** Test Result

Execution: **19 passed / 19 cases**.

| Booking cost (cents) | Slots | Expected Result | Test Result |
| --- | --- | --- | --- |
| [1001](pricing.test.ts#L6) | 3 | 333 / 167 / 666; maximum total safely bounded | 333 / 167 / 666; maximum total safely bounded |
| [6000](pricing.test.ts#L22) | 8 | 750 / 375 / 1500; maximum total safely bounded | 750 / 375 / 1500; maximum total safely bounded |
| [2](pricing.test.ts#L38) | 2 | 1 / 1 / 2; maximum total safely bounded | 1 / 1 / 2; maximum total safely bounded |
| [9007199254740991](pricing.test.ts#L54) | 2 | 4503599627370495 / 2251799813685248 / 4503599627370495; maximum total safely bounded | 4503599627370495 / 2251799813685248 / 4503599627370495; maximum total safely bounded |
| [9007199254740991](pricing.test.ts#L70) | 8 | 1125899906842623 / 562949953421312 / 1125899906842623; maximum total safely bounded | 1125899906842623 / 562949953421312 / 1125899906842623; maximum total safely bounded |
| [30000](pricing.test.ts#L86) | 30 | 1000 / 500 / 2000; maximum total safely bounded | 1000 / 500 / 2000; maximum total safely bounded |
| [9007199254740991](pricing.test.ts#L102) | 30 | 300239975158033 / 150119987579017 / 300239975158033; maximum total safely bounded | 300239975158033 / 150119987579017 / 300239975158033; maximum total safely bounded |
| [0](pricing.test.ts#L118) | 2 | INVALID_INPUT | INVALID_INPUT |
| [1](pricing.test.ts#L127) | 2 | INVALID_INPUT | INVALID_INPUT |
| [-1](pricing.test.ts#L136) | 2 | INVALID_INPUT | INVALID_INPUT |
| [1.5](pricing.test.ts#L145) | 2 | INVALID_INPUT | INVALID_INPUT |
| [NaN](pricing.test.ts#L154) | 2 | INVALID_INPUT | INVALID_INPUT |
| [Infinity](pricing.test.ts#L163) | 2 | INVALID_INPUT | INVALID_INPUT |
| [9007199254740992](pricing.test.ts#L172) | 2 | INVALID_INPUT | INVALID_INPUT |
| [1000](pricing.test.ts#L183) | 0 | INVALID_INPUT | INVALID_INPUT |
| [1000](pricing.test.ts#L192) | 1 | INVALID_INPUT | INVALID_INPUT |
| [1000](pricing.test.ts#L201) | 31 | INVALID_INPUT | INVALID_INPUT |
| [1000](pricing.test.ts#L210) | 2.5 | INVALID_INPUT | INVALID_INPUT |
| [1000](pricing.test.ts#L219) | NaN | INVALID_INPUT | INVALID_INPUT |
