-- Promotion kernel (host: icon editor). Neutral table names — no ad_ prefix.

create table if not exists app_settings (
  key   text primary key,
  value text not null
);

create table if not exists game_admins (
  player_id    text primary key,
  label        text not null default '',
  appointed_by text not null default '',
  created_at   text not null default ''
);

create table if not exists promo_codes (
  code       text primary key,
  label      text not null default '',
  grant_json text not null default '{}',
  active     integer not null default 1,
  created_by text not null default '',
  created_at text not null default '',
  updated_at text not null default '',
  expires_at text not null default '',
  max_claims integer not null default 0
);

create table if not exists promo_claims (
  code       text not null,
  player_id  text not null,
  claimed_at text not null default '',
  primary key (code, player_id)
);

create table if not exists ink_wallets (
  player_id  text primary key,
  ink        integer not null default 0,
  updated_at text not null default ''
);

create table if not exists player_unlocks (
  player_id text not null,
  unlock_id text not null,
  granted_at text not null default '',
  primary key (player_id, unlock_id)
);

create table if not exists watch_videos (
  id                 text primary key,
  label              text not null default '',
  duration_sec       integer not null default 60,
  active             integer not null default 1,
  owner_player_id    text not null default '',
  claim_once         integer not null default 0,
  show_channel       integer not null default 0,
  channel_url        text not null default '',
  channel_name       text not null default '',
  created_at         text not null default ''
);

create table if not exists watch_video_stats (
  video_id        text primary key,
  total_watch_sec integer not null default 0,
  claim_count     integer not null default 0
);

create table if not exists watch_claims (
  player_id     text not null,
  video_id      text not null,
  watch_sec     integer not null default 0,
  milestone_sec integer not null default 0,
  reward        integer not null default 0,
  day_jst       text not null default '',
  claimed_at    text not null default '',
  primary key (player_id, video_id, milestone_sec)
);

create table if not exists watch_player (
  player_id       text primary key,
  last_claimed_at text not null default '',
  last_video_id   text not null default '',
  last_watch_sec  integer not null default 0,
  total_watch_sec integer not null default 0,
  hour_key        text not null default '',
  hour_coins      integer not null default 0
);

create table if not exists watch_billing (
  player_id   text not null,
  video_id    text not null,
  billed_sec  integer not null default 0,
  updated_at  text not null default '',
  primary key (player_id, video_id)
);

create table if not exists partners (
  player_id       text primary key,
  credit_sec      integer not null default 0,
  total_credited  integer not null default 0,
  updated_at      text not null default ''
);

create table if not exists prepaid_codes (
  code        text primary key,
  hours       integer not null default 0,
  label       text not null default '',
  active      integer not null default 1,
  max_claims  integer not null default 1,
  claim_count integer not null default 0,
  expires_at  text not null default '',
  created_by  text not null default '',
  created_at  text not null default ''
);

create table if not exists prepaid_claims (
  code       text not null,
  player_id  text not null,
  claimed_at text not null default '',
  primary key (code, player_id)
);

create table if not exists banner_assets (
  id              text primary key,
  owner_player_id text not null,
  image_url       text not null,
  width           integer not null default 320,
  height          integer not null default 80,
  href            text not null default '',
  active          integer not null default 1,
  priority        integer not null default 0,
  created_at      text not null default ''
);

create table if not exists banner_events (
  id         text primary key,
  banner_id  text not null,
  kind       text not null,
  player_id  text not null default '',
  billed_sec integer not null default 0,
  created_at text not null default ''
);

create table if not exists banner_upload_log (
  id         text primary key,
  player_id  text not null,
  created_at text not null default ''
);

create table if not exists strip_text_presets (
  id         text primary key,
  player_id  text not null,
  name       text not null default '',
  payload    text not null default '{}',
  created_at text not null default ''
);

create index if not exists watch_claims_player_idx on watch_claims (player_id);
create index if not exists banner_assets_owner_idx on banner_assets (owner_player_id);
create index if not exists banner_events_banner_idx on banner_events (banner_id);
