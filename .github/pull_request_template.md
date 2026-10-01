## Use case(s)

<!-- e.g. UC2-04 -->

## Summary

## Dependencies and review

<!-- List affected owners. For missing dependencies, record the owner, source PR,
     agreed port/contract, test fake and criteria for replacing it/integrating.
     Link any explicit author delegation for someone else to update this branch. -->

## Checklist

- [ ] I am the author or have the author's explicit delegation to update this PR
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass locally
- [ ] No `number`/`float` used for money — integer cents only
- [ ] No wallet credit outside the Stripe webhook handler
- [ ] No Stripe SDK call outside `/app/wallet`, `/app/payouts`, `/app/api/webhooks`
- [ ] I requested review from the affected area owners; Rishi assigns a nonauthor
      peer for any area I own
- [ ] Required dependencies are on `main`, or the unresolved handoff and integration
      criteria are documented; source-branch imports have explicit authorization
- [ ] If this adds a migration, its owner and sequence/merge order are coordinated
      with Rishi

<!-- Reviewers leave comments; the author applies changes unless explicitly delegated.
     See docs/contributing-workflow.md for the complete review and merge policy. -->
