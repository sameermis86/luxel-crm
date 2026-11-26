# Access & security

## Module access
Modules: Sales & CRM (`sales`), Fulfillment & Ops (`ops`), Floral orders (`floral`), Finance (`finance`), Admin (`admin`).
Levels: none < view < edit < manage. Owners always have manage everywhere. Others: an explicit `user_access` row,
else the role default (manager: sales manage, ops edit; staff: sales edit, ops edit; nothing else).

- App: `authorize(session, action)` in `src/server/auth.ts` maps every action to a module level (plus a role for
  "see everyone's leads"). Pages declare theirs in `withPage(fn, action)`; the menu shows only granted modules.
- Database: `app.has_access(module, level)`; RESTRICTIVE policies on every Sales and Ops table (read: view,
  write: edit); settings/users/rules/integrations need admin manage. Defaults are mirrored in
  `app.default_access` and `src/lib/access.ts` (a test keeps them equal).
- Admin → Team & access: people, roles, module levels, invites / password resets. Admin → Audit log.

## Sign-in (Supabase mode)
- Email + password only (no email-link sign-in). Invite-only: owners send invites (and password resets) from
  Team & access. The app sends these itself from info@ (SMTP): `generateLink` gives a one-time token, the link
  goes to `/api/auth/confirm` (verifyOtp → session → "Set your password", no current password needed for 30
  minutes via the `luxel_pw_link` cookie). Needs `SUPABASE_SERVICE_ROLE_KEY` and the mailbox login. Links expire
  after 1 hour (Supabase email OTP lifetime). "Forgot password?" on the sign-in page uses Supabase's own email
  (PKCE, `/api/auth/callback`).
- Passwords: 12+ characters, letters and numbers, not name/email/"Luxel", and not found in known breaches
  (Have I Been Pwned range API: only a 5-character hash prefix leaves the server). Changing it needs the
  current password (except within 30 minutes of an invite/reset link) and signs out other devices.
- 2-step (authenticator app, Supabase TOTP): required for owners and anyone with Finance or Admin access;
  optional for others. Emergency switch: `MFA_REQUIRED=off` in Vercel (people who set it up still verify).
- Trusted device: after entering a code, "Trust this device for 30 days" sets `luxel_trusted_device` (HMAC, bound to
  the login and the authenticator). It skips the code only (password still needed). Ends on expiry, "sign out
  everywhere" or a password change (`sessions_valid_after`), removing/replacing the authenticator, or "Stop trusting
  this device" on the Account page. Audited.
- Sessions: our signed cookie `luxel_session` (HMAC, `SESSION_SECRET` or `CRON_SECRET`): 8h idle, 7 days max,
  enforced in middleware. "Sign out everywhere" and password changes set `users.sessions_valid_after`.
- Audit log (`audit_log`, append-only): sign-ins/outs, password and 2-step changes, people and access changes,
  invites.
