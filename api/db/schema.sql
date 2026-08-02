-- cast_log — one row per (visit × cast type), matching the long-format
-- schema in docs/backend.md Decision 2. A visit with two cast types writes
-- two rows sharing visit_id; every question this table gets asked
-- ("how many short leg slabs last month") is an aggregate over cast_type,
-- which is one GROUP BY away.
--
-- Run this once against the Neon database before the first deploy that
-- sets DATABASE_URL — api/log.js does not create tables itself.

create table if not exists cast_log (
  id            bigserial primary key,
  logged_at     timestamptz not null default now(),
  visit_id      text not null,
  shift_date    date not null,
  hn            text not null,
  patient_name  text not null,
  doctor_name   text not null,
  cast_type     text not null,
  cast_label    text not null,
  count         integer not null check (count between 1 and 20),
  source        text not null check (source in ('qr', 'manual')),
  app_version   text
);

-- Run against a database created before doctor_name existed — a fresh
-- `create table if not exists` above is a no-op there, so the column has to
-- be added separately. Nullable because rows written before this change
-- have no doctor on file.
alter table cast_log add column if not exists doctor_name text;

-- Dedupe lookups (Decision 4: at-least-once writes, deduped on read) and
-- the shift-date reports this table exists to make easy.
create index if not exists cast_log_visit_id_idx on cast_log (visit_id);
create index if not exists cast_log_shift_date_idx on cast_log (shift_date);

-- One row per visit per cast type, first write wins — the dedupe view a
-- retried submit needs. `distinct on` keeps the lowest id, i.e. the first
-- insert attempt rather than a later retry.
create or replace view cast_log_deduped as
select distinct on (visit_id, cast_type) *
from cast_log
order by visit_id, cast_type, id;

-- api_rate_limit — the fixed-window counter behind src/lib/ratelimit.js.
-- One row per limited key (currently "log:<ip>"); the window resets in
-- place via the upsert in checkRateLimit rather than this table growing
-- one row per request.
create table if not exists api_rate_limit (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null
);

-- allowed_line_users — the LIFF allowlist api/auth.js checks against,
-- replacing the config/allowed-line-users.json file. Rows are added by an
-- admin tapping "Accept" on the Telegram enrolment notification
-- (api/telegram-webhook.js) — see docs/backend.md for the full flow.
create table if not exists allowed_line_users (
  line_user_id  text primary key,
  display_name  text,
  added_at      timestamptz not null default now()
);
