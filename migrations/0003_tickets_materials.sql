-- Registration tickets + material catalog + Hobby connector secrets.

alter table ink_wallets add column if not exists tickets integer not null default 0;

create table if not exists grokbuild_external_connector (
  user_id     text not null,
  app_id      text not null,
  proxy_url   text not null default '',
  api_key     text not null default '',
  basic_user  text not null default '',
  basic_pass  text not null default '',
  namespace   text not null default 'default',
  setup_url   text not null default '',
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, app_id)
);

create table if not exists studio_materials (
  id              text primary key,
  owner_id        text not null,
  kind            text not null,
  title           text not null default '',
  width           integer not null default 0,
  height          integer not null default 0,
  thumb_url       text not null default '',
  storage         text not null default 'local',
  remote_snap_id  integer,
  status          text not null default 'pending',
  created_at      text not null default ''
);

create table if not exists material_blobs (
  id         text primary key,
  owner_id   text not null,
  image_url  text not null,
  created_at text not null default ''
);

create index if not exists studio_materials_owner_idx on studio_materials (owner_id);
create index if not exists studio_materials_status_idx on studio_materials (status, created_at);
