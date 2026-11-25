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
- Email + password only (no email-link sign-in). Invite-only: owners send invites from Team & access
  (needs `SUPABASE_SERVICE_ROLE_KEY`). "Forgot password?" sends a reset link to /account/password.
- Passwords: 12+ characters, letters and numbers, not name/email/"Luxel", and not found in known breaches
  (Have I Been Pwned range API: only a 5-character hash prefix leaves the server). Changing it needs the
  current password (except within 30 minutes of an invite/reset link) and signs out other devices.
- 2-step (authenticator app, Supabase TOTP): required for owners and anyone with Finance or Admin access;
  optional for others. Emergency switch: `MFA_REQUIRED=off` in Vercel (people who set it up still verify).
- Sessions: our signed cookie `luxel_session` (HMAC, `SESSION_SECRET` or `CRON_SECRET`): 8h idle, 7 days max,
  enforced in middleware. "Sign out everywhere" and password changes set `users.sessions_valid_after`.
- Audit log (`audit_log`, append-only): sign-ins/outs, password and 2-step changes, people and access changes,
  invites.
