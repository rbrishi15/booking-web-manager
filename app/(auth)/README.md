# /app/(auth)

**Owner:** Joseph (Jolingoes)

UC1-01 Register User, UC1-02 Authenticate User. Approval for this directory
may be given by Joseph alone (delegated review — see CLAUDE.md "Directory
ownership"), so routine interface changes don't queue behind payment work.

## Login and registration presentation

The auth pages share a monochrome court backdrop and a form card. Desktop and
mobile use separate decorative images reconstructed from the supplied design
references; the [asset notes](../../public/images/auth-court.md) record their
provenance. Styles are scoped to these pages and reuse the existing controls.

Headers use the shared `BookingLogo` navigation size (20px); brand typography is
owned by that module rather than auth-specific overrides. The small wordmark on
the court image also reuses it with inherited white text. Review captures:
[desktop](../../docs/assets/shared-logo-auth-desktop.jpg) and
[mobile](../../docs/assets/shared-logo-auth-mobile.jpg).

Registration starts with region, email and password. **Sign Up** validates those
details using the existing registration schema and opens the required name and
preferred-sport step. **Create account** submits all five fields and the validated
return destination to the server action. Both steps remain mounted so Back and validation errors preserve
the draft. Terms and privacy links appear before the final submission.

The email control accepts a complete address or an address with a selected
ending. Complete addresses with other or multi-label domains remain editable in
full. The form submits one complete `email` value; the server remains responsible
for validation. Password strength is a visual hint, not an additional policy.

Run `npm run test:e2e:auth` for responsive layout, navigation, field controls,
step transitions and failed-validation checks. This suite uses an isolated Next
development server with dummy Supabase settings and creates no accounts. Run it
separately from production builds because both write to `.next`. Successful
sign-in, registration and confirmation still need a configured Supabase service.

## Invitation continuation

`/sessions/{sessionId}/join?token=...` is a public preview for a UUID session ID.
Its token is checked by the session reader; becoming signed in never joins a
session automatically. Other Sessions routes remain protected. Missing or
unavailable authentication does not block this invitation preview; Discover itself now requires an active login.
Invitation responses and authentication/recovery responses carrying their return
destination use `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.

Login, registration, their switch links, duplicate-account recovery, confirmation
resends and the email callback retain the same-site `next` destination. Every
server action and callback validates it with `safeRedirectPath`; external URLs,
control characters, backslashes and auth-page loops fall back to Home. The
callback removes its one-use code and provider error text. Failed confirmation
keeps `next` on login or signed-in email recovery, which offers an explicit return
link. This continuation never submits a commitment or grants private-session access.
An invitee whose account lacks an email also retains the invitation through
the join dialog's **Add email** link and the email-management return link.

## Terms and privacy

`/terms` and `/privacy` are public (`PUBLIC_PATHS` in `redirect-path.ts`) so the
register form can link to them before sign-up. They share the
[`InfoPage`](./_components/info-page.tsx) frame, which has no app sidebar.

## Email confirmation (UC1-01 / UC1-02)

Hosted email confirmations are currently disabled; see the
[hosted Auth configuration](../../supabase/README.md#auth-config-site-url-redirects-email-confirmation).
Successful registration creates an account and returns a session immediately.
The register action redirects to the validated return destination, or Home,
without sending a confirmation email.
Enabling confirmations switches registration to the `"check-email"` flow:
the account stays signed out until confirmation completes.

Signup and resend explicitly use the Server Action request's origin plus
`/auth/callback` as `emailRedirectTo`, with an encoded `next` query when returning
to an invitation or another app page. Next.js validates that action origin
against the host. This keeps the return link on the site where the browser's
PKCE cookie was created, without a hardcoded localhost fallback or an extra
Vercel environment variable.

The public callback exchanges Supabase's `code` for a cookie session, then
re-reads the Auth user before returning to that destination without the code. Middleware lets
it run before checking for a session. Failed exchanges go to login with recovery
instructions, or to `/profile/email` when an existing session is still usable. Signup
without a session stays signed out; the confirmation notice and unconfirmed
login both offer a new email link.

Signed-in accounts without an email receive a nonblocking setup prompt.
Unconfirmed addresses do not block session creation or joining. `/profile/email` can add a missing email, resend confirmation and recheck
the current Auth user after a link is opened in another tab or browser. Signed-in
resend targets come from the Auth user, never submitted form fields. Adding an
email uses `updateUser` on that same account; its `new_email` remains pending
until confirmed. With an empty current email, repeat that update to resend the
pending addition. The public resend endpoint looks accounts up by current email,
so passing a pending address to it can silently send nothing.

Booking eligibility uses the trusted current email address, not
`email_confirmed_at`, `confirmed_at` or editable metadata. Email-confirmation
state remains available for the optional email-management flow.

### Required hosted Supabase settings

In [Authentication → URL Configuration](https://supabase.com/dashboard/project/rofrvxezteioulhlnfcj/auth/url-configuration):

1. Set **Site URL** to `https://booking-web-manager.vercel.app`.
2. Add `https://booking-web-manager.vercel.app/auth/callback` to **Redirect URLs**.
   Also allow `https://booking-web-manager.vercel.app/auth/callback\?next=**`
   for the encoded continuation query. The backslash makes `?` literal in the
   allowlist glob; it is not part of the actual callback URL.
3. For local development, also allow `http://localhost:3000/auth/callback`
   and `http://127.0.0.1:3000/auth/callback` (adjust ports if needed). Add only
   trusted preview origins when testing signup on Vercel previews. For each
   trusted origin/port, add both the exact callback and the same
   `/auth/callback\?next=**` pattern. Its wildcard is confined to the query;
   do not add a wildcard for every site path.
4. When confirmations are enabled, in **Email Templates → Confirm signup**, keep
   the confirmation link as
   `<a href="{{ .ConfirmationURL }}">Confirm your email</a>`. A custom link
   hardcoded to localhost or using only `{{ .SiteURL }}` will not complete this
   callback flow. This app expects the default confirmation URL and PKCE code,
   not a custom `/auth/confirm?token_hash=...` template.
5. Keep **Confirm email** disabled for the current hosted setup. If enabled,
   Supabase's built-in sender remains an option; custom SMTP is optional for
   delivery beyond the built-in sender's restrictions.

For missing-email recovery, in **Change email**, retain the default
`{{ .ConfirmationURL }}` link. Secure email change may require confirmation from
both old and new addresses when an old email exists; an email addition with no
old address only confirms the new one.

These are hosted Auth settings; deploying code or running database migrations
does not update them. A redirect outside the allowlist can fall back to Site
URL. See [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
The [Supabase Auth redirect validator](https://github.com/supabase/auth/blob/master/internal/utilities/request.go)
matches allowlist patterns against the URL including its query (excluding its
fragment). Its current source separately permits the Site URL origin, but do
not rely on a particular hosted version for local or preview origins. Verify
the generated link retains `next` when testing a new confirmation email.

When confirmations are enabled, after deployment and configuration, request a
**new** confirmation email; existing emails retain their old links. Open it in
the browser used to sign up or resend. If it opens in another browser, the email
may still be verified, but automatic sign-in cannot use the original browser's PKCE cookie: log in
with the account password instead. See [PKCE limitations](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

### Verification

Run `npm test -- tests/app/auth tests/use-cases/UC1-01-register-user.test.ts tests/use-cases/UC1-02-authenticate-user.test.ts`.
These cover redirect selection, session completion, invitation continuation,
failed links, middleware access and the unverified state. For the current hosted configuration, smoke-test
registration with a fresh account on production: verify immediate authenticated
access to Home without a confirmation email.

If confirmations are enabled, verify registration returns `"check-email"` and
stays signed out, open the new email in that browser, and verify that Home is
authenticated. Also try logging in before confirmation and resending a link.
Repeat from a private-session invitation: login, immediate registration,
confirmation and recovery must return to that exact preview, where joining
still needs the player's explicit confirmation.
