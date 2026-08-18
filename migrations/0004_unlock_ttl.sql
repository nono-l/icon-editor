-- Unlock TTL (90 days) + one ink per banner click per day.

alter table player_unlocks add column if not exists expires_at text not null default '';

create table if not exists banner_ink_claims (
  player_id  text not null,
  banner_id  text not null,
  day_jst    text not null,
  claimed_at text not null default '',
  primary key (player_id, banner_id, day_jst)
);
