# Scheduled sync

`POST /api/cron/wix-sync` (Bearer `CRON_SECRET`) runs every integration in one go: Wix forms and
Quote Builder, Goodshuffle stages, the Fulfillment & Ops board, and Setmore bookings (including the
automatic consult-status moves).

## Who calls it
| Caller | Schedule | Notes |
|---|---|---|
| **Supabase pg_cron**, job `luxel-sync` | every 15 min | The main schedule. Uses `pg_net`; the secret is read from Supabase Vault (`luxel_cron_secret`). |
| GitHub Actions `wix-sync.yml` | "every 15 min" | Backup only: GitHub throttles schedules on quiet repos (often hours apart). Also handy for a manual run. |
| Vercel Cron (`vercel.json`) | daily | Backup; the Hobby plan allows one run a day. |

Running it more often than needed is harmless: every step is idempotent.

## Operating the pg_cron job (Supabase SQL editor)
```sql
-- recent runs (pg_cron) and the endpoint's replies (pg_net keeps ~6h)
select status, start_time, return_message from cron.job_run_details order by start_time desc limit 10;
select created, status_code, left(content, 200) from net._http_response order by created desc limit 10;

-- pause / resume
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'luxel-sync';
select cron.alter_job(jobid, active := true)  from cron.job where jobname = 'luxel-sync';
```
If `CRON_SECRET` is rotated in Vercel, update the Vault copy too:
`select vault.update_secret(id, '<new secret>') from vault.secrets where name = 'luxel_cron_secret';`
