# Taswiqat account authentication

The Express backend preserves Manus OAuth, its session cookie, the privately pinned administrator, existing users and role/status enforcement. Email, Google and Apple are additive account-login methods, not social publishing integrations. Independent credentials remain unconfigured and no live email/provider login has been attempted. The parent executed the authorized additive v3 migration on 17 November 2026 at 12:32 UTC: existing users, administrator count and pin, workspaces, subscriptions, plan rows and global revision 10 remained unchanged; the three new authentication tables were empty. Offline fixtures remain confined to memory and use fabricated accounts and generated test keys only.

## Configuration and current availability

`MANUS_PROJECT_ID` and `MANUS_JWT_SECRET` remain the platform-provided session configuration. Existing Manus login additionally needs `MANUS_OAUTH_PORTAL_URL` and `MANUS_OAUTH_API_URL`. Missing independent credentials never disable an otherwise configured Manus fallback. `/api/auth/options` can serve Manus capabilities on schema v2 while new methods remain disabled until v3.

New methods require an explicit `TASWIQAT_AUTH_ORIGIN`, exactly an HTTPS origin such as `https://taswiqat.manus.space`, without a trailing slash, credentials, path, query or fragment. There is no implicit sender/provider callback origin. Never derive it from Host, forwarded Host, Origin or a caller-supplied redirect URL.

Email requires `TASWIQAT_EMAIL_API_KEY` for the Resend HTTPS API and `TASWIQAT_EMAIL_FROM` for a Resend-approved sender. The sender accepts an email address or a display-name address such as `Taswiqat <auth@your-verified-domain>`. Configure a domain verified with Resend and a sending-enabled API key. Do not paste secret values in chat, source files, config files or logs. There is no SMTP dependency. Password login also fails closed when this email method is unconfigured, consistent with its advertised capability.

Google requires `TASWIQAT_GOOGLE_CLIENT_ID` and `TASWIQAT_GOOGLE_CLIENT_SECRET` from a Web application OAuth client. Register the exact callback `TASWIQAT_AUTH_ORIGIN/api/auth/google/callback` in Google Cloud Console and configure the product branding/consent screen. Only `openid email profile` scopes are requested; no offline access or social publishing scopes. Google documents the server authorization-code flow and verifies identities using `sub`, not email. [1]

Apple requires `TASWIQAT_APPLE_CLIENT_ID` for the Services ID, `TASWIQAT_APPLE_TEAM_ID`, `TASWIQAT_APPLE_KEY_ID` and `TASWIQAT_APPLE_PRIVATE_KEY` for a Sign in with Apple P-256 private key. Supply the PEM through protected server configuration, never a committed file; actual newlines and escaped newline sequences are accepted. Register `TASWIQAT_AUTH_ORIGIN/api/auth/apple/callback` as the return URL, configure the associated primary App ID and Services ID, and verify its domain. Apple's return URL must be HTTPS on a domain, not localhost or an IP. The server generates an ES256 client-secret JWT valid for five minutes with Team ID issuer, Services ID subject, Apple audience and key ID. [2] [3] [5]

`TASWIQAT_PUBLIC_ORIGINS` accepts comma-separated **exact** public origins. The production origin `https://taswiqat.manus.space` is trusted by default for challenge issuance. Explicit Preview origins continue to be accepted without wildcard siblings. The existing `TASWIQAT_TRUST_PROXY` and guarded loopback Origin-rewrite behavior are preserved, but pre-authentication never trusts Host or a custom origin header alone.

Independent methods are disabled when configuration is missing or structurally invalid, or the database schema is unready. `email/google/apple: true` means the server configuration is structurally available, not that a key has been validated live or that an external service is healthy. Sender and OAuth rejections remain sanitized and fail closed. This work does not claim that independent credentials are supplied, provider consoles configured, email delivery tested or live provider logins completed.

## Frontend challenge and capability contract

Use credentialed same-origin requests. Call:

```text
GET /api/auth/options?origin=<encodeURIComponent(window.location.origin)>
```

The JSON response contains exactly these capabilities plus the browser-bound pre-authentication CSRF token:

```json
{"manus":true,"email":false,"google":false,"apple":false,"registrationEnabled":true,"csrfToken":"opaque-token-or-null"}
```

The values are runtime-dependent. No client secrets, key names/values, provider tokens, administrator pin/email, raw database errors or raw provider errors are returned. When signing configuration is absent, capabilities are false and `csrfToken` is null. When there is signing configuration but no independent credentials, a normal challenge is still issued for the exact trusted canonical/Preview origin. An invalid caller origin is rejected. Malformed origin configuration does not invent a challenge.

The challenge cookie `taswiqat_preauth` is signed, HttpOnly, Secure and SameSite=None on public HTTPS and expires after 20 minutes. Never replace it with frontend storage. The response `csrfToken` is HMAC-bound to that cookie. Subsequent email POSTs and provider-start GETs must include:

```text
X-CSRF-Token: <options.csrfToken>
X-Taswiqat-Origin: <window.location.origin>
```

A browser's normal Origin header must agree with the signed challenge origin. Preview may rewrite it to an internal loopback listener: accepting the custom public origin then requires an actual loopback peer, an exact matching internal Origin/Host, a signed cookie, its CSRF HMAC and an exact configured public origin. Missing browser-origin headers are rejected on pre-auth POSTs. Fetch again when the challenge expires. Do not refresh options while an OAuth navigation is pending because callbacks bind to the initiating challenge cookie.

Authenticated mutations continue to use the separate `csrfToken` from `/api/session`, not the pre-authentication token. Existing `/api/session`, `/api/auth/start`, `/api/auth/callback`, `/api/auth/logout` and administrator role checks retain their frontend contracts.

## Email requests and responses

All email action requests are JSON with a maximum body size of 8 KiB. Extra fields are rejected. Names are trimmed, limited to 160 characters and reject control characters/angle brackets. Emails are trimmed and lowercased without Gmail dot/plus alias rewriting. Passwords are not trimmed; they must be 12–128 characters without NUL. Render all names/messages as text, never HTML.

```text
POST /api/auth/email/register  {"name":"...","email":"..."}
POST /api/auth/email/verify    {"token":"...","password":"..."}
POST /api/auth/email/login     {"email":"...","password":"..."}
POST /api/auth/email/forgot    {"email":"..."}
POST /api/auth/email/reset     {"token":"...","password":"..."}
```

Register never accepts or stores a pre-verification password. It sends a 256-bit random token after committing only a pending token record. There is no user, credential or authenticated session until verified proof is consumed and the password is chosen. The token record binds its hash, purpose, normalized email, name and expiry; reset additionally binds the existing local user's ID and session version. Token validity is 20 minutes, and row-lock plus conditional update consumption is transactional and one-use.

Verification links are exactly `TASWIQAT_AUTH_ORIGIN/#auth/verify?token=...`; recovery links are exactly `TASWIQAT_AUTH_ORIGIN/#auth/reset?token=...`. Tokens remain in the fragment rather than reaching a server URL or HTTP referrer. The frontend must read the fragment, never log the token, remove it from history after reading, and POST it to the corresponding endpoint. Resending uses register again; once the new sender request is confirmed, older tokens for that email/purpose are invalidated. Pending or rejected sends never produce usable proof tokens.

For registration/recovery, HTTP 200 `{ok:true,message}` is returned **only after the real sender reports acceptance with a message ID**. The generic Arabic response is identical whether the address is eligible or not. To avoid exposing account existence via success booleans, ineligible or disabled-registration requests receive a generic security notice **without a verification/reset link or token**; that notice changes no account and uses no administrator-specific wording. Only verified local credentials for an active non-operator user can receive recovery proof. A same-email Manus/Google/Apple account, or the approved operator email, cannot acquire local credentials or reset an OAuth account. Users should use their original login method.

Sender acceptance is not inbox delivery. Resend's send API returns an accepted message ID; rejected responses, missing IDs, network failures or timeouts produce a sanitized failure, never a sent-message claim. [4]

Verification and login return HTTP 200 `{ok:true,message}` and set the existing `webdev_app_session` cookie. Use `/api/session` to load the authenticated account and its authenticated CSRF token; navigate only to `/#app`. Reset returns HTTP 200 `{ok:true,message}` but creates no session; it increments the local user's session version, invalidates older sessions and outstanding tokens, and asks the user to log in again. Do not treat register/forgot success as authentication.

Errors follow the existing JSON contract:

```json
{"error":{"code":"email_not_configured","message":"خدمة البريد غير متاحة حاليًا؛ لم تُرسل رسالة"}}
```

Codes include `validation_error` 400, `invalid_token` 400, `invalid_credentials` 401, `csrf_invalid`/`origin_mismatch` 403, `registration_disabled` 403, `account_unavailable` 403, `rate_limited` 429, `email_not_configured`/`schema_not_ready` 503, and `email_send_failed` 502. Password reset/verification token failures are generic. Raw Zod/provider/SQL messages are not emitted from these endpoints. The general API handles oversized JSON as 413 and malformed JSON as 400 with Arabic messages.

## Google and Apple navigation

After obtaining the browser challenge, call one of:

```text
GET /api/auth/google/start?origin=<exact-origin>
GET /api/auth/apple/start?origin=<exact-origin>
```

Include the same challenge headers and credentials. A configured start returns `{url}` pointing only to that provider's fixed authorization endpoint. Navigate the top-level browser to it; do not embed the provider consent screen or accept a caller return URL.

Google uses random state, nonce and S256 PKCE. The short-lived signed state cookie contains the code verifier; the server exchanges the code with the exact registered callback and verifies the ID token against Google's fixed JWKS, RS256, allowed issuer, client audience, authorized party when present, subject, issuance/expiry, nonce and verified email. Google's PKCE protocol defines a high-entropy verifier and base64url SHA-256 S256 challenge. [1] [6]

Apple requests `name email`, code response and `form_post`. Its callback is `POST /api/auth/apple/callback` with bounded URL-encoded form data, maximum 12 KiB/10 parameters. The external Apple form cannot attach the app's custom CSRF header; **the protocol callback uses its state plus browser-bound signed OAuth cookie and original challenge-cookie digest instead**. This is the sole pre-auth POST protocol exception; it is not an unprotected email action. State must match and its database nonce is atomically consumed before code exchange. Callback handling never treats unsigned callback `id_token`/`user.email` as identity. The server exchanges the code, verifies the returned Apple ID-token signature, issuer, audience, subject, expiry and nonce, and accepts relay addresses as ordinary verified contact emails. Missing/empty Apple email is handled as an absent contact field, not as identity. No PKCE parameter is pretended for Apple: its documented REST request exposes state and nonce but does not document PKCE. [2] [3] [7] [8]

Apple names are unsigned, first-authorization-only data; they are sanitized and bounded. Existing names are retained when later callbacks omit the initial user object. [2] Neither provider retains unnecessary access/refresh tokens.

Successful provider callbacks set the existing session cookie and redirect only to `TASWIQAT_AUTH_ORIGIN/#app`. Cancellation, missing cookies, replay, expired state, code exchange failure, identity collision, suspended status or disabled registration redirect to the fixed view `TASWIQAT_AUTH_ORIGIN/#auth/login?error=provider_login_failed`, using 303 and no-referrer. The UI should show a generic Arabic explanation such as «تعذر إكمال تسجيل الدخول؛ حاول مجددًا أو استخدم طريقة الدخول المعتادة». Never display query tokens or raw provider errors. Malformed/oversized Apple form callbacks use the same safe redirect. With invalid canonical configuration the error fallback is the fixed relative `/#auth/login?error=provider_login_failed`.

Browser cookies cannot be handed between different hostnames. Provider start therefore requires the initiating browser origin to equal `TASWIQAT_AUTH_ORIGIN`; otherwise it returns 409 `canonical_login_required`. For development, set that exact origin to the active Preview/custom domain and register matching provider callback URLs, or open login on the canonical production host. A different-origin Preview can use Manus and issue its own challenge but cannot inherit a canonical-domain provider session. Third-party cookie blocking can also prevent embedded Preview login; use a top-level tab on the configured host rather than weakening cookies or state validation.

## Identity, administrator and migration safety

New users keep `taswiqat_users.open_id NOT NULL` and get random synthetic namespaces `taswiqat:email:<new UUID>` or `taswiqat:oidc:<new UUID>`. Email is never an `open_id`, provider subject is never the operator pin, and provider identities are never auto-linked by email. Manus provider IDs using the reserved synthetic namespace are rejected. New methods create only role `user`; the operator's pinned Manus identity remains the sole administrator path. No new method writes `taswiqat_private_admin` or claims a pin from an email.

V3 is additive and idempotent under the existing migration lock. It adds `users.session_version BIGINT UNSIGNED NOT NULL DEFAULT 0`, binary provider/subject identity uniqueness, unique normalized local login-email credentials, and hashed purpose-bound auth token records. The readiness table list and schema version are updated. Existing names, users, pin, memberships, roles, content, credentials and plan rows are not reset or rewritten. Existing Manus/Preview JWTs without `sv` remain compatible when the database version is zero. Every new app session includes `sv`; middleware requires `(payload.sv || 0) === user.session_version` on every request.

`DEFAULT_PLANS` changes only new-database seed prices to basic 49, pro 99 and enterprise 199 while retaining names, channels, members and active flags. Migration v3 never reseeds existing prices; the administrator's separately approved live CMS edits remain canonical.

Migration v3 is now applied. The restarted development backend reports HTTP 200 with schemaVersion 3. Exact-origin capabilities report Manus available and email/Google/Apple unavailable until independent configuration is supplied. No reseeding or administrator reconfiguration is needed. Do not insert test accounts into the shared managed database: it is used by development and publication.

Passwords use Node's asynchronous scrypt with per-password 128-bit salts, versioned fixed N=32768/r=8/p=1 parameters, a 64-byte result and constant-time comparison. Unknown-email login performs the same KDF cost. Concurrent password work is bounded to four operations per app instance. Pre-auth email routes limit IP and normalized email independently, with bounded in-memory buckets; verify/reset apply email limits after resolving proof. These buckets are process-local, so production with multiple instances should add a trusted shared limiter or gateway control before increasing auth traffic. Durable OAuth state and email-proof replay protection are in MySQL, not process memory.

## Offline validation

Run `env -u DATABASE_URL -u DRIZZLE_DATABASE_URL node --test tests/*.test.mjs` to prevent the pre-existing opt-in managed-DB health test from executing. The new account suite injects memory transactions, synthetic users, generated cryptographic test keys and mocked HTTPS exchanges/senders. It covers pre-auth CSRF/origin/Preview behavior, proof purpose/expiry/replay, password bounds and hashing, pinned/email collisions, disabled registration, session-version compatibility, Google JWT/PKCE verification, Apple client-secret/relay/name behavior, provider callback replay/fixed redirects, body bounds and additive/idempotent migration behavior. No live services or shared fixtures are needed.

Final offline run: 75 tests discovered, 74 passed, zero failed, one existing live managed-DB test deliberately skipped. Four route-regression cases verify that paired same-view mounts retain the in-memory scrubbed proof, a genuinely new proof replaces and erases the old one, stale handles cannot remove a newer controller, and exit clears proof. Three additional admin cases cover real settings bounds, version/CSRF payloads preserving other collections, and invalid/stale forms retaining input without writes. Modified/new JavaScript modules passed `node --check`; no independent live authentication or mail-delivery claim follows from these offline results.

## References

[1]: https://developers.google.com/identity/openid-connect/openid-connect "Google OpenID Connect server flow and identity claims"
[2]: https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server. "Apple authorization request, form callback and first-time user data"
[3]: https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens "Apple authorization-code token validation"
[4]: https://resend.com/docs/api-reference/emails/send-email "Resend email API and acceptance response"
[5]: https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret "Apple ES256 client-secret fields and signing"
[6]: https://developers.google.com/identity/protocols/oauth2/native-app "Google PKCE verifier and S256 protocol"
[7]: https://developer.apple.com/documentation/signinwithapplejs/authorizationi/id_token "Apple ID-token subject, email, relay and nonce claims"
[8]: https://developer.apple.com/documentation/signinwithapple/verifying-a-user "Apple server identity and session verification"
