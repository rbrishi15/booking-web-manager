# Account test cases

Snapshot: **2026-10-24, payout refactor** · **95 cases, 95 passed**. See the [domain testing guide](../README.md) and [execution evidence](../results/README.md).

Each row is one test case. The first input value links to its test definition. Input columns precede **Expected Result** (Oracle) and **Test Result** (Log). Test Result records only assertion-verified outcomes from the passing snapshot, not captured runtime payloads. Matching result cells are expected for passing cases; partial matches, identity checks and approximate comparisons retain their stated limits.

## assertDeactivationAllowed — obligations

Each row supplies all six obligation fields. Balances are integer cents; the count fields are the number of outstanding obligations.

**Input:** Available balance (cents), Held balance (cents), Active commitments, Unsettled owned sessions, Pending payouts, Active owned groups · **Oracle:** Expected Result · **Log:** Test Result

Execution: **5 passed / 5 cases**.

| Available balance (cents) | Held balance (cents) | Active commitments | Unsettled owned sessions | Pending payouts | Active owned groups | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [0](deactivation-policy.test.ts#L5) | 0 | 0 | 0 | 0 | 0 | No error | No error |
| [0](deactivation-policy.test.ts#L11) | 500 | 0 | 0 | 0 | 0 | Throws error with code ACTIVE_OBLIGATIONS | Throws error with code ACTIVE_OBLIGATIONS |
| [0](deactivation-policy.test.ts#L19) | 0 | 0 | 0 | 0 | 1 | Throws error with code ACTIVE_OBLIGATIONS | Throws error with code ACTIVE_OBLIGATIONS |
| [−1](deactivation-policy.test.ts#L27) | 0 | 0 | 0 | 0 | 0 | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [0](deactivation-policy.test.ts#L35) | 0 | 0.5 | 0 | 0 | 0 | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |

## Email constructor — address integrity

Quoted values preserve spaces and escapes exactly; `\t`, `\n`, `\r`, `\u2028` and `\u00a0` denote the corresponding input characters, not literal backslashes.

**Input:** Email address · **Oracle:** Expected Result · **Log:** Test Result

Execution: **19 passed / 19 cases**.

| Email address | Expected Result | Test Result |
| --- | --- | --- |
| [`"owner@example.com"`](email.test.ts#L6) | Exact address: `"owner@example.com"` | Exact address: `"owner@example.com"` |
| [`"Owner+bookings@Example.COM"`](email.test.ts#L14) | Exact address: `"Owner+bookings@Example.COM"` | Exact address: `"Owner+bookings@Example.COM"` |
| [`"owner@localhost"`](email.test.ts#L22) | Exact address: `"owner@localhost"` | Exact address: `"owner@localhost"` |
| [`""`](email.test.ts#L32) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner.example.com"`](email.test.ts#L40) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"@example.com"`](email.test.ts#L48) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner@"`](email.test.ts#L56) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner@@example.com"`](email.test.ts#L64) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner@example@com"`](email.test.ts#L72) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`" "`](email.test.ts#L82) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`" owner@example.com"`](email.test.ts#L90) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner@example.com "`](email.test.ts#L98) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"own er@example.com"`](email.test.ts#L106) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner@exam ple.com"`](email.test.ts#L114) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner\t@example.com"`](email.test.ts#L122) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner@example.com\n"`](email.test.ts#L130) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner@example.com\r\n"`](email.test.ts#L138) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner@example.com\u2028"`](email.test.ts#L146) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"owner@\u00a0example.com"`](email.test.ts#L154) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |

## Email.equals — exact text equality


**Input:** Email address, Other email address · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Email address | Other email address | Expected Result | Test Result |
| --- | --- | --- | --- |
| [`Owner@example.com`](email.test.ts#L164) | `Owner@example.com` | true | true |
| [`Owner@example.com`](email.test.ts#L173) | `owner@example.com` | false | false |
| [`Owner@example.com`](email.test.ts#L182) | `Owner@EXAMPLE.COM` | false | false |
| [`Owner@example.com`](email.test.ts#L191) | `other@example.com` | false | false |

## PayoutAccount constructor — setup state

Payout account ID `account`, user `owner`, and provider account reference `provider` apply to all PayoutAccount cases below.

**Input:** Setup status, Bank reference · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Setup status | Bank reference | Expected Result | Test Result |
| --- | --- | --- | --- |
| [COMPLETE](payout-account.test.ts#L6) | bank | Status COMPLETE; bank reference bank | Status COMPLETE; bank reference bank |
| [COMPLETE](payout-account.test.ts#L18) | Absent | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [PENDING](payout-account.test.ts#L26) | bank | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |

## PayoutAccount.completeSetup — confirmation

The freshly completed case first completes a pending account with `bank`, then repeats that confirmation. The restored case starts with a constructed COMPLETE account.

**Input:** Initial setup status, Stored bank reference, Confirmation bank reference · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Initial setup status | Stored bank reference | Confirmation bank reference | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [PENDING](payout-account.test.ts#L36) | Absent | bank | Different returned instance: COMPLETE, bank bank; original stays PENDING with no bank reference | Different returned instance: COMPLETE, bank bank; original stays PENDING with no bank reference |
| [COMPLETE (freshly completed)](payout-account.test.ts#L48) | bank | bank | Same completed account instance | Same completed account instance |
| [COMPLETE (restored)](payout-account.test.ts#L57) | bank | bank | Same restored account instance | Same restored account instance |
| [FAILED](payout-account.test.ts#L70) | Absent | bank | Throws error with code INVALID_STATE | Throws error with code INVALID_STATE |

## PayoutAccount.failSetup — failure


**Input:** Initial setup status, Stored bank reference · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Initial setup status | Stored bank reference | Expected Result | Test Result |
| --- | --- | --- | --- |
| [PENDING](payout-account.test.ts#L80) | Absent | Different returned instance: FAILED with no bank reference; original stays PENDING | Different returned instance: FAILED with no bank reference; original stays PENDING |

## User constructor — loaded wallet and memberships

Loaded-user defaults: ACTIVE, verified `<userId>@example.com`, wallet `w-<userId>` funded with 10000 cents, reliability 100, no groups, empty preferences and no payout account. Top-ups occur at **2026-10-08 10:00 UTC**, also the registration time. The table changes only the listed loaded data.

**Input:** User ID, Memberships, Wallet owner, Wallet funds (cents) · **Oracle:** Expected Result · **Log:** Test Result

Execution: **5 passed / 5 cases**.

| User ID | Memberships | Wallet owner | Wallet funds (cents) | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [alice](user-related-data.test.ts#L17) | undefined | alice | 10000 | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [alice](user-related-data.test.ts#L28) | null | alice | 10000 | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [alice](user-related-data.test.ts#L39) | Empty array | other | 0 | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [alice](user-related-data.test.ts#L54) | Array containing `" "` | alice | 10000 | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [alice](user-related-data.test.ts#L65) | Set containing group (not an array) | alice | 10000 | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |

## User.create — registration

Registration time is 2026-10-08 10:00 UTC. Preferences are empty unless shown otherwise.

**Input:** User ID, Email address, Wallet ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases**.

| User ID | Email address | Wallet ID | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [new-user](user-related-data.test.ts#L76) | new@example.com | new-wallet | User and wallet owner new-user; email new@example.com; wallet new-wallet; empty transactions; 0 cents; reliability 100; empty memberships | User and wallet owner new-user; email new@example.com; wallet new-wallet; empty transactions; 0 cents; reliability 100; empty memberships |
| [owner](user.test.ts#L109) | owner@example.com | w-owner | Status ACTIVE; same Email instance supplied at registration; email unverified | Status ACTIVE; same Email instance supplied at registration; email unverified |

## User constructor — supplied account data isolation

Construct loaded user `alice` with wallet `w-alice`, then replace the supplied wallet with an empty wallet, replace its reliability with 0, and append `other` to the supplied memberships.

**Input:** Wallet funds (cents), Reliability, Memberships, Replacement wallet funds (cents), Replacement reliability, Appended membership · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Wallet funds (cents) | Reliability | Memberships | Replacement wallet funds (cents) | Replacement reliability | Appended membership | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [700](user-related-data.test.ts#L98) | 80 | group | 0 | 0 | other | Same original wallet instance w-alice, 700 cents; same original reliability instance, 80; memberships exactly group | Same original wallet instance w-alice, 700 cents; same original reliability instance, 80; memberships exactly group |

## User.memberGroupIds — returned collection isolation

Read the memberships of loaded user `alice`, then append the stated ID to the returned array.

**Input:** Stored memberships, Appended membership · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Stored memberships | Appended membership | Expected Result | Test Result |
| --- | --- | --- | --- |
| [group](user-related-data.test.ts#L125) | injected | Stored memberships exactly group | Stored memberships exactly group |

## User.wallet — reassignment protection

Attempt to assign a replacement wallet to loaded user `alice`; both wallets have ID `w-alice`.

**Input:** Original wallet funds (cents), Replacement wallet funds (cents) · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Original wallet funds (cents) | Replacement wallet funds (cents) | Expected Result | Test Result |
| --- | --- | --- | --- |
| [700](user-related-data.test.ts#L140) | 0 | Reassignment returns false; same original wallet instance; 700 cents | Reassignment returns false; same original wallet instance; 700 cents |

## User.reliabilityScore — reassignment protection

Attempt to assign a replacement score to loaded user `alice`.

**Input:** Original reliability, Replacement reliability · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Original reliability | Replacement reliability | Expected Result | Test Result |
| --- | --- | --- | --- |
| [80](user-related-data.test.ts#L153) | 0 | Reassignment returns false; same original score instance; 80 | Reassignment returns false; same original score instance; 80 |

## User constructor — restored account state

Use the loaded-user defaults above for user `owner`. An inactive account has unverified null email. Where present, payout account `account` has provider reference `provider`; COMPLETE state uses bank `bank`. “Account state” comparisons cover email, verification, account status, sports, regions, and payout account ID/status/bank reference.

**Input:** Account status, Email address, Email verified, Payout status, Payout owner · **Oracle:** Expected Result · **Log:** Test Result

Execution: **6 passed / 6 cases**.

| Account status | Email address | Email verified | Payout status | Payout owner | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- |
| [ACTIVE](user.test.ts#L15) | null | true | Absent | — | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [ACTIVE](user.test.ts#L21) | Owner+bookings@Example.COM | true | Absent | — | Same supplied Email instance; exact text Owner+bookings@Example.COM | Same supplied Email instance; exact text Owner+bookings@Example.COM |
| [ACTIVE](user.test.ts#L31) | null | false | Absent | — | Status ACTIVE; null email; email unverified | Status ACTIVE; null email; email unverified |
| [INACTIVE](user.test.ts#L45) | owner@example.com | false | Absent | — | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [INACTIVE](user.test.ts#L57) | null | false | COMPLETE | owner | Status INACTIVE; null email; restored account state equals the original deactivated account | Status INACTIVE; null email; restored account state equals the original deactivated account |
| [ACTIVE](user.test.ts#L77) | owner@example.com | true | PENDING | other-user | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |

## User constructor — supplied preference isolation

Use loaded user `owner`, then clear both supplied preference sets after construction.

**Input:** Preferred sports, Preferred regions, Supplied sets after construction · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Preferred sports | Preferred regions | Supplied sets after construction | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [Tennis](user.test.ts#L90) | West | Both empty | Stored sports exactly Tennis; stored regions exactly West | Stored sports exactly Tennis; stored regions exactly West |

## User.create — supplied preference isolation

Register `owner`, email `owner@example.com`, wallet `w-owner` at 2026-10-08 10:00 UTC, then clear both supplied preference sets.

**Input:** Preferred sports, Preferred regions, Supplied sets after registration · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Preferred sports | Preferred regions | Supplied sets after registration | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [Tennis](user.test.ts#L124) | West | Both empty | Stored sports exactly Tennis; stored regions exactly West | Stored sports exactly Tennis; stored regions exactly West |

## User.updateProfile — email and verification

User ID is `owner`; no groups or payout account; reliability 100; preferences empty. The verified-email cases have 10000 wallet cents; the unverified and inactive cases have 0 cents. Inactive accounts have null email. Account-state comparisons use the fields defined above.

**Input:** Account status, Current email, Email verified, New email · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Account status | Current email | Email verified | New email | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [ACTIVE](user.test.ts#L146) | owner@example.com | true | new@example.com | Email unverified | Email unverified |
| [ACTIVE](user.test.ts#L154) | owner@example.com | true | owner@example.com | Email remains verified | Email remains verified |
| [ACTIVE](user.test.ts#L162) | owner@example.com | false | new@example.com | Same supplied new Email instance; text new@example.com | Same supplied new Email instance; text new@example.com |
| [INACTIVE](user.test.ts#L173) | null | false | new@example.com | Throws error with code INACTIVE_ACCOUNT; account state unchanged | Throws error with code INACTIVE_ACCOUNT; account state unchanged |

## User.updatePreferences — replacing preferences

User `owner` starts with 0 wallet cents and empty preferences; ACTIVE accounts have unverified `owner@example.com`, INACTIVE accounts have null email. No payout account, groups, or other obligations.

**Input:** Account status, New preferred sports, New preferred regions · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Account status | New preferred sports | New preferred regions | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [ACTIVE](user.test.ts#L185) | Tennis | West | Stored sports exactly Tennis; stored regions exactly West | Stored sports exactly Tennis; stored regions exactly West |
| [ACTIVE](user.test.ts#L197) | Tennis | `" "` | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |
| [INACTIVE](user.test.ts#L210) | Tennis | West | Throws error with code INACTIVE_ACCOUNT; account state unchanged | Throws error with code INACTIVE_ACCOUNT; account state unchanged |

## User.preferredSports — returned set isolation

Use loaded-user defaults for `owner`; clear the returned sports set.

**Input:** Stored preferred sports, Returned sports after mutation · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Stored preferred sports | Returned sports after mutation | Expected Result | Test Result |
| --- | --- | --- | --- |
| [Tennis](user.test.ts#L223) | Empty set | Stored sports exactly Tennis | Stored sports exactly Tennis |

## User.preferredRegions — returned set isolation

Use loaded-user defaults for `owner`; clear the returned regions set.

**Input:** Stored preferred regions, Returned regions after mutation · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Stored preferred regions | Returned regions after mutation | Expected Result | Test Result |
| --- | --- | --- | --- |
| [West](user.test.ts#L238) | Empty set | Stored regions exactly West | Stored regions exactly West |

## User.beginPayoutSetup — starting setup

For all lifecycle cases below, user `owner` defaults to ACTIVE, unverified `owner@example.com`, empty preferences, 0 wallet cents, reliability 100 and no memberships. Existing payout accounts use ID `account`, provider reference `provider`, and bank `bank` only when COMPLETE. Account-state comparisons use the fields defined above.

**Input:** Existing payout status, New payout account ID, New provider account reference · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Existing payout status | New payout account ID | New provider account reference | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [Absent](user.test.ts#L255) | account | provider | Payout status PENDING; account ID account; user ID owner; provider reference provider | Payout status PENDING; account ID account; user ID owner; provider reference provider |
| [PENDING](user.test.ts#L270) | replacement | other-provider | Throws error with code INVALID_STATE; account state unchanged | Throws error with code INVALID_STATE; account state unchanged |
| [COMPLETE](user.test.ts#L283) | replacement | other-provider | Throws error with code INVALID_STATE; account state unchanged | Throws error with code INVALID_STATE; account state unchanged |

## User.beginPayoutSetup then completePayoutSetup — replacing failed setup


**Input:** Existing payout status, New payout account ID, New provider reference, Confirmation bank reference · **Oracle:** Expected Result · **Log:** Test Result

Execution: **1 passed / 1 cases**.

| Existing payout status | New payout account ID | New provider reference | Confirmation bank reference | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [FAILED](user.test.ts#L298) | replacement | other-provider | replacement-bank | Payout status COMPLETE; destination account replacement; destination bank replacement-bank | Payout status COMPLETE; destination account replacement; destination bank replacement-bank |

## User.completePayoutSetup — confirmation


**Input:** Existing payout status, Stored bank reference, Confirmation bank reference · **Oracle:** Expected Result · **Log:** Test Result

Execution: **4 passed / 4 cases**.

| Existing payout status | Stored bank reference | Confirmation bank reference | Expected Result | Test Result |
| --- | --- | --- | --- | --- |
| [PENDING](user.test.ts#L315) | Absent | bank | New payout-account instance: COMPLETE, bank bank; account ID account, user ID owner, provider reference provider preserved; original account stays PENDING | New payout-account instance: COMPLETE, bank bank; account ID account, user ID owner, provider reference provider preserved; original account stays PENDING |
| [Absent](user.test.ts#L339) | Absent | bank | Throws error with code PAYOUT_ACCOUNT_NOT_READY | Throws error with code PAYOUT_ACCOUNT_NOT_READY |
| [PENDING](user.test.ts#L347) | Absent | `" "` | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |
| [COMPLETE](user.test.ts#L357) | bank | different-bank | Throws error with code INVALID_STATE; account state unchanged | Throws error with code INVALID_STATE; account state unchanged |

## User.failPayoutSetup — failure


**Input:** Existing payout status, Stored bank reference · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Existing payout status | Stored bank reference | Expected Result | Test Result |
| --- | --- | --- | --- |
| [PENDING](user.test.ts#L369) | Absent | New payout-account instance: FAILED, bank reference absent; original account stays PENDING | New payout-account instance: FAILED, bank reference absent; original account stays PENDING |
| [Absent](user.test.ts#L382) | Absent | Throws error with code PAYOUT_ACCOUNT_NOT_READY | Throws error with code PAYOUT_ACCOUNT_NOT_READY |
| [COMPLETE](user.test.ts#L390) | bank | Throws error with code INVALID_STATE; account state unchanged | Throws error with code INVALID_STATE; account state unchanged |

## User.payoutDestination — usable destination

INACTIVE users have null email. Other lifecycle defaults remain as stated above.

**Input:** Account status, Payout status, Bank reference, Attempted bank reference · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Account status | Payout status | Bank reference | Attempted bank reference | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [ACTIVE](user.test.ts#L404) | Absent | Absent | Not attempted | Throws error with code PAYOUT_ACCOUNT_NOT_READY | Throws error with code PAYOUT_ACCOUNT_NOT_READY |
| [ACTIVE](user.test.ts#L412) | COMPLETE | bank | another-bank | Initial destination and account destination after attempted change: account account; user owner; provider provider; bank bank | Initial destination and account destination after attempted change: account account; user owner; provider provider; bank bank |
| [INACTIVE](user.test.ts#L435) | COMPLETE | bank | Not attempted | Throws error with code INACTIVE_ACCOUNT | Throws error with code INACTIVE_ACCOUNT |

## User.deactivate — outstanding obligations

Start with the ACTIVE lifecycle user described above. Each row passes all six deactivation fields; a rejection must preserve the complete observed account state.

**Input:** Available balance (cents), Held balance (cents), Active commitments, Unsettled owned sessions, Pending payouts, Active owned groups · **Oracle:** Expected Result · **Log:** Test Result

Execution: **14 passed / 14 cases**.

| Available balance (cents) | Held balance (cents) | Active commitments | Unsettled owned sessions | Pending payouts | Active owned groups | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [1](user.test.ts#L449) | 0 | 0 | 0 | 0 | 0 | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged |
| [0](user.test.ts#L463) | 1 | 0 | 0 | 0 | 0 | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged |
| [0](user.test.ts#L477) | 0 | 1 | 0 | 0 | 0 | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged |
| [0](user.test.ts#L491) | 0 | -1 | 0 | 0 | 0 | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |
| [0](user.test.ts#L505) | 0 | 0.5 | 0 | 0 | 0 | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |
| [0](user.test.ts#L519) | 0 | 0 | 1 | 0 | 0 | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged |
| [0](user.test.ts#L533) | 0 | 0 | -1 | 0 | 0 | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |
| [0](user.test.ts#L547) | 0 | 0 | 0.5 | 0 | 0 | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |
| [0](user.test.ts#L561) | 0 | 0 | 0 | 1 | 0 | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged |
| [0](user.test.ts#L572) | 0 | 0 | 0 | -1 | 0 | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |
| [0](user.test.ts#L583) | 0 | 0 | 0 | 0.5 | 0 | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |
| [0](user.test.ts#L597) | 0 | 0 | 0 | 0 | 1 | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged | Throws error with code ACTIVE_OBLIGATIONS; account state unchanged |
| [0](user.test.ts#L611) | 0 | 0 | 0 | 0 | -1 | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |
| [0](user.test.ts#L625) | 0 | 0 | 0 | 0 | 0.5 | Throws error with code INVALID_INPUT; account state unchanged | Throws error with code INVALID_INPUT; account state unchanged |

## User.deactivate — anonymisation and repeated requests

Every deactivation field is zero. User ID remains `owner`; an initial COMPLETE payout account has ID `account`, provider `provider`, bank `bank`. The inactive case first deactivates an ordinary ACTIVE user, captures its resulting account state, then calls deactivate again.

**Input:** Initial account status, Preferred sports, Preferred regions, Payout status · **Oracle:** Expected Result · **Log:** Test Result

Execution: **3 passed / 3 cases**.

| Initial account status | Preferred sports | Preferred regions | Payout status | Expected Result | Test Result |
| --- | --- | --- | --- | --- | --- |
| [ACTIVE](user.test.ts#L639) | Tennis | West | Absent | Status INACTIVE; null email; sports and regions both empty | Status INACTIVE; null email; sports and regions both empty |
| [ACTIVE](user.test.ts#L653) | Empty | Empty | COMPLETE | User ID owner; same wallet instance; same payout-account instance; bank bank | User ID owner; same wallet instance; same payout-account instance; bank bank |
| [INACTIVE (already deactivated)](user.test.ts#L668) | Empty | Empty | Absent | Account state unchanged | Account state unchanged |

## UserHandle.parse — Telegram-style user IDs

Added after the 2026-10-24 snapshot with [ADR-0021](../../../docs/adr/0021-user-ids-for-finding-players.md); these rows are not yet in the snapshot's JSON evidence. Quoted values are typed exactly as shown. A user ID keeps 5–32 characters of `a-z`, `0-9` and `_`, starts with a letter, and never ends with or repeats an underscore.

**Input:** Typed user ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **14 passed / 14 cases** (run 2026-10-24).

| Typed user ID | Expected Result | Test Result |
| --- | --- | --- |
| [`"marcus_lim"`](user-handle.test.ts#L5) | Stored `marcus_lim`; shown `@marcus_lim` | Stored `marcus_lim`; shown `@marcus_lim` |
| [`"  @Marcus_Lim "`](user-handle.test.ts#L12) | Stored `marcus_lim` | Stored `marcus_lim` |
| [`"abc12"` (5 characters)](user-handle.test.ts#L18) | Stored `abc12` | Stored `abc12` |
| [32 × `"a"`](user-handle.test.ts#L24) | Stored unchanged | Stored unchanged |
| [`"abcd"` (4 characters)](user-handle.test.ts#L32) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [33 × `"a"`](user-handle.test.ts#L36) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"9marcus"`](user-handle.test.ts#L40) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"_marcus"`](user-handle.test.ts#L44) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"marcus_"`](user-handle.test.ts#L48) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"marcus__lim"`](user-handle.test.ts#L52) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"marcus.lim"`](user-handle.test.ts#L56) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"marcus lim"`](user-handle.test.ts#L60) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"marcüs_lim"`](user-handle.test.ts#L64) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |
| [`"@"`](user-handle.test.ts#L68) | Throws error with code INVALID_INPUT | Throws error with code INVALID_INPUT |

## UserHandle.equals — case-insensitive identity

**Input:** User ID, Other user ID · **Oracle:** Expected Result · **Log:** Test Result

Execution: **2 passed / 2 cases** (run 2026-10-24).

| User ID | Other user ID | Expected Result | Test Result |
| --- | --- | --- | --- |
| [`"Marcus_Lim"`](user-handle.test.ts#L72) | `"marcus_lim"` | Equal | Equal |
| [`"marcus_lim"`](user-handle.test.ts#L79) | `"marcus_tan"` | Not equal | Not equal |
