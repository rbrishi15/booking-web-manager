# /app/(auth)

**Owner:** Joseph (Jolingoes)

UC1-01 Register User, UC1-02 Authenticate User. Approval for this directory
may be given by Joseph alone (delegated review — see CLAUDE.md "Directory
ownership"), so routine interface changes don't queue behind payment work.

## Email confirmation (UC1-01 / UC1-02)

Hosted email confirmations are currently disabled; see the
[hosted Auth configuration](../../supabase/README.md#auth-config-site-url-redirects-email-confirmation).
Successful registration creates an account and returns a session immediately.
The register action redirects to Home without sending a confirmation email.
Enabling confirmations switches registration to the `"check-email"` flow:
the account stays signed out until confirmation completes.

Signup and resend explicitly use the Server Action request's origin plus
`/auth/callback` as `emailRedirectTo`. Next.js validates that action origin
against the host. This keeps the return link on the site where the browser's
PKCE cookie was created, without a hardcoded localhost fallback or an extra
Vercel environment variable.

The public callback exchanges Supabase's `code` for a cookie session, then
re-reads the Auth user before redirecting Home without the code. Middleware lets
it run before checking for a session. Failed exchanges go to login with recovery
instructions, or to `/profile/email` when an existing session is still usable. Signup
without a session stays signed out; the confirmation notice and unconfirmed
login both offer a new email link.

Signed-in accounts with a missing or unconfirmed email receive a nonblocking
prompt. `/profile/email` can add a missing email, resend confirmation and recheck
the current Auth user after a link is opened in another tab or browser. Signed-in
resend targets come from the Auth user, never submitted form fields. Adding an
email uses `updateUser` on that same account; its `new_email` remains pending
until confirmed. With an empty current email, repeat that update to resend the
pending addition. The public resend endpoint looks accounts up by current email,
so passing a pending address to it can silently send nothing.

Session actions use the trusted current email and `email_confirmed_at`, not
`confirmed_at` or editable user metadata. Existing Supabase-confirmed accounts
remain accepted; this change does not require all legacy accounts to reconfirm.

### Required hosted Supabase settings

In [Authentication → URL Configuration](https://supabase.com/dashboard/project/rofrvxezteioulhlnfcj/auth/url-configuration):

1. Set **Site URL** to `https://booking-web-manager.vercel.app`.
2. Add `https://booking-web-manager.vercel.app/auth/callback` to **Redirect URLs**.
3. For local development, also allow `http://localhost:3000/auth/callback`
   and `http://127.0.0.1:3000/auth/callback` (adjust ports if needed). Add only
   trusted preview origins when testing signup on Vercel previews.
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

When confirmations are enabled, after deployment and configuration, request a
**new** confirmation email; existing emails retain their old links. Open it in
the browser used to sign up or resend. If it opens in another browser, the email
may still be verified, but automatic sign-in cannot use the original browser's PKCE cookie: log in
with the account password instead. See [PKCE limitations](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

### Verification

Run `npm test -- tests/app/auth tests/use-cases/UC1-01-register-user.test.ts tests/use-cases/UC1-02-authenticate-user.test.ts`.
These cover redirect selection, session completion, failed links, middleware
access and the unverified state. For the current hosted configuration, smoke-test
registration with a fresh account on production: verify immediate authenticated
access to Home without a confirmation email.

If confirmations are enabled, verify registration returns `"check-email"` and
stays signed out, open the new email in that browser, and verify that Home is
authenticated. Also try logging in before confirmation and resending a link.
