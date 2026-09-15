# /domain

**Owner:** Rishi (rbrishi15)

Pure TypeScript. No framework imports, no DB, no HTTP — see CLAUDE.md
"Non-negotiable rules" and "Architecture". Business rules, policy engines and
interfaces (ledger operations, session and commitment result types) live here.
`/app` depends on `/domain`; `/domain` depends on nothing.

Publish the ledger interface and Money type here first — the other roles
build against these signatures.
