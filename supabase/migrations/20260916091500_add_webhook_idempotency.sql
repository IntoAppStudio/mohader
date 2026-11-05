-- Idempotency ledger for payment-provider webhooks (duplicate delivery is
-- normal/expected behavior for webhooks, not an edge case — providers retry
-- on anything but a fast 2xx). service-role only; no client ever touches this.
create table if not exists public.processed_webhook_events (
  provider text not null,
  event_id text not null,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table public.processed_webhook_events enable row level security;
grant all on public.processed_webhook_events to service_role;
-- deliberately no policy for `authenticated` — service_role bypasses RLS
-- entirely, and no other role should ever read or write this table.
