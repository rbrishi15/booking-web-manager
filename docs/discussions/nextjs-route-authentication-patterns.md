# Authentication abstractions for Next.js routes

Research date: **2026-10-02**. Scope: authentication, dependency loading and error
handling around this project's Next.js 15 App Router session endpoints. This
records source research and the selected local design; it is not a security audit.
The sample is targeted: reviewed application files are evidence of real code,
not a census of industry practice or proof of what a hosted service currently
deploys. Commit links make the observations reproducible.

## Findings from primary sources

| Source and kind | Observed pattern | What the evidence establishes |
| --- | --- | --- |
| Next.js **15.5.25**, framework documentation | An exported Route Handler calls `verifySession()` and checks access; reusable checks live near data access. | Official guidance supports ordinary functions and centralized authorization. Its examples do not prescribe our use-case/domain structure. [Authentication guide](https://github.com/vercel/next.js/blob/013ee1d2f25326197453d129430a6da83b86426d/docs/01-app/02-guides/authentication.mdx#L1324-L1373), [centralized checks](https://github.com/vercel/next.js/blob/013ee1d2f25326197453d129430a6da83b86426d/docs/01-app/02-guides/authentication.mdx#L1027-L1040). |
| Auth.js, **official App Router example** | `GET = auth(callback)`; the callback checks `req.auth` and returns 401 without a session. | A function wrapper is an officially demonstrated pattern. This small example is not a production application's authorization architecture. [Example source](https://github.com/nextauthjs/next-auth/blob/a1a16a5a7780488c7449feece410033f445d0b31/apps/examples/nextjs/app/api/protected/route.ts#L1-L9). |
| Auth.js, **library implementation** | `initAuth` accepts a handler; `handleAuth` obtains session state, supplies `req.auth`, invokes the handler and preserves session cookies. | The example's wrapper has a real implementation. Authentication context and handler authorization are distinct; using this wrapper alone does not imply every callback is denied when no session exists. [Wrapper dispatch](https://github.com/nextauthjs/next-auth/blob/a1a16a5a7780488c7449feece410033f445d0b31/packages/next-auth/src/lib/index.ts#L202-L213), [handler execution](https://github.com/nextauthjs/next-auth/blob/a1a16a5a7780488c7449feece410033f445d0b31/packages/next-auth/src/lib/index.ts#L233-L285). |
| Dub, **application App Router code** | GET and POST link handlers use `withWorkspace(callback, options)`. The callback receives explicit session/workspace/request context; options declare required permissions. | Function wrappers are used in a product repository, not just a demo. Its wrapper also handles rate limits, plan checks and logging—more policy than this school project needs. [Routes](https://github.com/dubinc/dub/blob/7e0101363b2ab30afc537c1893f159d1dcba513a/apps/web/app/api/links/route.ts), [wrapper](https://github.com/dubinc/dub/blob/7e0101363b2ab30afc537c1893f159d1dcba513a/apps/web/lib/auth/workspace.ts). |
| Formbricks, **application App Router code** | Webhook routes use `withV1ApiWrapper({ handler, ... })`; callbacks receive authentication context and retain operation-specific workspace authorization. | A wrapper can centralize repeated work without replacing endpoint authorization. Its handler-error catch does not enclose every earlier authentication step, so it is not an exact template for our error policy. [Routes](https://github.com/formbricks/formbricks/blob/f1fc4adbc38bf49615fc13db30698c056a381a60/apps/web/app/api/v1/webhooks/route.ts), [wrapper](https://github.com/formbricks/formbricks/blob/f1fc4adbc38bf49615fc13db30698c056a381a60/apps/web/app/lib/api/with-api-logging.ts). |
| Cal.diy, **application App Router code** | An OAuth route explicitly checks bearer authorization and exports its handler through `defaultResponderForAppDir`, a function wrapper for error handling and instrumentation. | A real application separates explicit auth from a reusable outer response wrapper. This public repository has Cal.com lineage; it is not evidence about the current hosted Cal.com implementation. [Route](https://github.com/calcom/cal.diy/blob/54343aa685ae8f33159d2f485ec4a57bad5c574a/apps/web/app/api/auth/oauth/me/route.ts#L7-L18), [response wrapper](https://github.com/calcom/cal.diy/blob/54343aa685ae8f33159d2f485ec4a57bad5c574a/apps/web/app/api/defaultResponderForAppDir.ts#L11-L72). |

Version scope matters: the inspected Dub manifest uses Next.js **15.5.8**;
Formbricks uses **16.3.6**. Formbricks is evidence for a JavaScript design pattern,
not a Next.js 15 compatibility test.
[Dub manifest](https://github.com/dubinc/dub/blob/7e0101363b2ab30afc537c1893f159d1dcba513a/apps/web/package.json),
[Formbricks manifest](https://github.com/formbricks/formbricks/blob/f1fc4adbc38bf49615fc13db30698c056a381a60/apps/web/package.json).

The inspected Auth.js documentation also shows separate App Router and Pages
Router integrations. Its current proxy guidance includes Next.js 16 terminology;
that is not a reason to rename this Next.js 15 project's middleware. This report
uses the version-pinned Next.js 15 sources for framework-specific conclusions.
[Auth.js protection guide](https://github.com/nextauthjs/next-auth/blob/a1a16a5a7780488c7449feece410033f445d0b31/docs/pages/getting-started/session-management/protecting.mdx#L144-L235).

## Supported does not mean recommended

Next.js 15.5.25 recognizes `experimentalDecorators`, so legacy method decorators
are technically supported. The same version's compiler guide describes this as
compatibility support and explicitly says: **“We do not recommend using legacy
decorators in new applications.”** This is materially different from saying that
Next.js could not compile the earlier decorator implementation. It is also
distinct from TypeScript's newer standard-decorator semantics.
[Version-pinned compiler guidance](https://github.com/vercel/next.js/blob/013ee1d2f25326197453d129430a6da83b86426d/docs/03-architecture/nextjs-compiler.mdx#L157-L169),
[TypeScript's distinction](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#differences-with-experimental-legacy-decorators).

Neither the Auth.js example nor the framework guide establishes a universal rule
against classes. The Next.js guide even mentions grouping related data requests
in a class; that is not a recommendation for authentication method decorators.
[Class-related guidance](https://github.com/vercel/next.js/blob/013ee1d2f25326197453d129430a6da83b86426d/docs/01-app/02-guides/authentication.mdx#L1126-L1130).

There are legitimate decorator-based precedents, with different integration
contracts. The inspected `next-api-decorators` library instantiates a controller
and returns a handler accepting `NextApiRequest` and `NextApiResponse`: it targets
the Pages API contract, so it is not a drop-in App Router alternative. Its auth
example supplies middleware and mutates `req.user`; parameter injection relies on
the library's metadata and argument construction.
[Handler implementation](https://github.com/instantcommerce/next-api-decorators/blob/92dc475a4f0e32b31bb18fa8f8c0121106f2c137/lib/createHandler.ts#L27-L49),
[authentication example](https://github.com/instantcommerce/next-api-decorators/blob/92dc475a4f0e32b31bb18fa8f8c0121106f2c137/examples/with-next-auth/pages/api/users/%5B%5B...params%5D%5D.ts#L22-L45),
[argument dispatch](https://github.com/instantcommerce/next-api-decorators/blob/92dc475a4f0e32b31bb18fa8f8c0121106f2c137/lib/internals/handler.ts#L60-L112).

NestJS makes controller decorators, dependency injection and guard execution
framework responsibilities. Its JWT sample uses an injected guard and execution
context; its documented `@Auth(...)` composes metadata and guards. These are sound
precedents within Nest's framework, rather than evidence that Next supplies those
conventions. The earlier local design's optional positional arguments were an
application-owned protocol.
[JWT guard](https://github.com/nestjs/nest/blob/7fb52e7f4f7314fbc117e369a09297bc2ecadf6b/sample/19-auth-jwt/src/auth/auth.guard.ts#L13-L45),
[controller](https://github.com/nestjs/nest/blob/7fb52e7f4f7314fbc117e369a09297bc2ecadf6b/sample/19-auth-jwt/src/auth/auth.controller.ts#L13-L27),
[official decorator composition](https://docs.nestjs.com/custom-decorators#decorator-composition).

## Review of the earlier decorator design

These observations describe the implementation reviewed before the explicit-helper
design was selected. Its local `SessionRoutes` class and `@Errors`,
`@Dependencies` and `@Auth` method decorators have been replaced.

That implementation had useful properties: separate error/dependency/auth
functions, no shared user state, no Request mutation, direct use-case calls, and
fresh authentication on each invocation. Its dependency wrapper deliberately
redacted setup failures before feature-specific error mapping. Those properties
are independent of the `@` syntax.

Its interface also required maintainers to know the decorator order, the injected
second and third method arguments, their `missingRouteContext()` defaults, and
the legacy compiler flag. The required `Errors` → `Dependencies` → `Auth` order
was a runtime convention rather than a constraint expressed by their TypeScript
types. `@Dependencies` discarded Next's route context and any caller-supplied
identity. That was appropriate for the static route, but limited reuse for
dynamic routes. The class existed for method decoration, rather than to represent
state or behavior that naturally belonged to an object. These were design costs,
not evidence of an authentication bypass; tests of working execution and actor
isolation do not decide whether the abstraction is the simplest one.

Auth.js's request augmentation is evidence of a wrapper pattern, not a reason to
copy its `req.auth` mutation into this project. A local wrapper could instead
pass an explicit typed context to a callback, while the exported function retains
Next's normal Request-to-Response shape.

## Selected design for this school project

The selected implementation uses ordinary async GET and POST functions in the
[session route](../../app/api/sessions/route.ts). Each handler calls
[`loadDependencies`](../../app/http/load-dependencies.ts), then
[`requireUserId`](../../app/http/require-user-id.ts), then its feature's request
reader and use case. One `try`/`catch` delegates failures to the feature response
mapper. Dependencies and verified identities are explicit local values; request
readers, response mappers and direct use-case calls remain feature-owned.

`loadDependencies` preserves the distinction between setup failures and request
failures. `requireUserId` invokes the supplied endpoint authenticator, rejects a
missing identity and validates the returned UUID. Neither helper mutates the
Request or retains actor state between calls. This removes the decorator order,
injected optional arguments and legacy compiler flag from this route's design.

**Design judgment:** this has the fewest conventions for a new teammate to learn
at the current scale and follows the framework's documented function-based route
shape. The choice preserves the existing Supabase authentication integration and
the full-User/Participant use-case workflow.

The preference for reusable additions without visible wrapper chains is
reasonable. If reducing repeated setup/error orchestration remains important,
one small function wrapper with explicit typed context is an option to evaluate.
It can accept separate auth/dependency/error functions through one call, without
requiring a controller framework, reflection metadata or legacy decorators. This
remains an alternative rather than the selected implementation or a reason to
rewrite every API. The earlier decorators could work; compilation and passing
tests did not make them the framework's recommended choice.

The decision is about the abstraction's cost at this project's scale: explicit
helpers repeat a few orchestration lines; one wrapper introduces a callback
context; three decorators introduce ordering and positional injection. The
repository examples justify a small wrapper as a conventional option, not copying
their commercial policy machinery or introducing Nest for two endpoints.

The selected design preserves this project's established policies: setup errors
are opaque 500s; malformed verified identities are 500s; only identified client
parsing failures become 400s; GET verifies identity before query validation and
the use case loads one complete User and authorizes its Participant; POST checks
current account access before parsing or replay; discovery responses always use
`no-store`. These are local behavioral contracts, not policies inferred from the
external examples.
See [route regression tests](../../tests/app/sessions/create-session-route.test.ts)
and [discovery regression tests](../../tests/app/discover/discovery-route.test.ts).

For example, Dub's global classification of Zod errors differs from this
project's classification by origin. Reusing the wrapper shape does not require
copying that error policy.
[Dub error mapper](https://github.com/dubinc/dub/blob/7e0101363b2ab30afc537c1893f159d1dcba513a/apps/web/lib/api/errors.ts#L93-L158).
