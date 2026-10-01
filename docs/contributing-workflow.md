# Contribution workflow

## Author and reviewer responsibilities

The PR author owns updates to their branch. Reviewers leave comments or suggested
changes for the author to apply. Another contributor or agent may edit or push
that branch only after the author explicitly delegates the work; record the
scope of that delegation in the PR. A review request, repository write access,
or a CODEOWNERS entry is not delegation.

Start feature work from `main` and keep the PR within its stated scope. Use
semantic commit messages. Include the relevant use-case IDs, validation results
and affected areas in the PR. Update ownership rules when adding a new feature
path so review routing follows the feature across architectural layers.

## Missing dependencies

Agree the required port or contract with the dependency's owner. The consumer
can progress against that boundary with deterministic test fakes while the
owner delivers the production implementation in their own PR. Record:

- The dependency owner and source PR (or a tracked request until the PR exists).
- The agreed interface and behavior, including relevant failures.
- The test fake, remaining integration work and acceptance criteria for using
  the real implementation.

Source changes reach `main` through their owners' reviewed PRs. Then update the
consumer from `main`, replace test-only substitutes in integration coverage and
verify the documented acceptance criteria. A PR that requires the missing
implementation stays blocked from integration until those criteria are met;
an independently useful port or contract can be reviewed separately.

Do not copy, cherry-pick or merge another feature branch into the consumer
without an explicit request authorizing that source and scope. Author
delegation to update a PR does not by itself authorize importing other branches.
Document an authorized exception and its dependency order in the PR.

Keep a blocked PR's next required action and responsible person visible in its
description or latest status comment. When a PR becomes ready to merge, record
the remaining merge action and Rishi or his explicitly named delegate.

If a dependency or review has no response after one working day, ask Rishi in
the existing discussion for status and an expected completion time. Rishi
remains accountable for the follow-up unless he explicitly delegates it to a
named person. This is a manual follow-up, not an automatic reminder or
permission to take over the work.

## Review and merge

Request review from every affected area owner in
[CODEOWNERS](../.github/CODEOWNERS). Each affected area needs review by someone
other than the author. Where the author is the area owner, Rishi assigns a
nonauthor peer to review that area; this also applies to Rishi's own PRs.
Cross-area changes retain each area's review responsibility.

Rishi coordinates reviewer assignment, dependency order and merging. A routine
area review does not require an additional Rishi approval merely because he
merges it. Before merging, confirm independent reviews cover the changed areas,
required CI passes, review conversations are resolved, and required source
dependencies are on `main`. The author addresses findings or explains a
disagreement in the review discussion; reviewers verify the resulting changes.

Keep migrations in one numbered sequence. The feature owner reviews the schema;
Rishi coordinates numbering and merges prerequisite migrations before dependent
integration. Ledger changes retain Harrison's review, authentication/profile
schema retains Joseph's, and session schema retains Neoh's. Changes crossing
these boundaries request all affected reviews.

## Ownership and GitHub enforcement

CODEOWNERS routes review requests using the last matching rule. Multiple names
on one rule do not require approval from every listed person. It grants no
editing permissions. GitHub uses CODEOWNERS from a PR's base branch, so a
proposed ownership change does not change review routing for that same PR.
See [GitHub's CODEOWNERS documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

Branch protection and rulesets determine which checks GitHub actually enforces;
the policy above also covers coordination that those settings may not express.
If the contributor's account cannot read the complete protection settings,
record enforcement as unverified and ask an administrator with sufficient
access to confirm them. An unreadable settings response is not evidence that
protections are absent or enabled.

Rishi or an administrator should verify the following for `main`. This checklist
records the intended policy, not a claim that the current settings enforce it:

- Require a PR and at least one independent approval, with current code-owner
  review where applicable. Check that own-area PRs can satisfy review through
  the assigned independent peer; do not bypass review when a setting conflicts.
- Require the applicable CI checks and resolution of review conversations.
- Prevent direct and force pushes to `main`, including administrator bypasses
  that would defeat these requirements.
- Confirm required reviews still cover the final changes before merging.

Changing GitHub settings is a separate administrator action. Editing these
documents or CODEOWNERS does not enable those protections.
