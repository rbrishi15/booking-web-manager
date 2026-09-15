## Use case(s)

<!-- e.g. UC2-04 -->

## Summary

## Checklist

- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass locally
- [ ] No `number`/`float` used for money — integer cents only
- [ ] No wallet credit outside the Stripe webhook handler
- [ ] No Stripe SDK call outside `/app/wallet`, `/app/payouts`, `/app/api/webhooks`
- [ ] If this touches another member's directory, I've requested their review
      (see CODEOWNERS) in addition to Rishi's
- [ ] If this adds a migration, it's the next number in sequence and no other
      migration PR is open
