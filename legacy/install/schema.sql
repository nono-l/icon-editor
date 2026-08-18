SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(32) NOT NULL,
  email VARCHAR(190) NOT NULL,
  pass_hash VARCHAR(255) NOT NULL,
  name VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS game_admins (
  player_id VARCHAR(32) NOT NULL,
  label VARCHAR(64) NOT NULL DEFAULT '',
  appointed_by VARCHAR(32) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS promo_codes (
  code VARCHAR(32) NOT NULL,
  label VARCHAR(80) NOT NULL DEFAULT '',
  grant_json TEXT NOT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  created_by VARCHAR(32) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  expires_at VARCHAR(32) NOT NULL DEFAULT '',
  max_claims INT NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS promo_claims (
  code VARCHAR(32) NOT NULL,
  player_id VARCHAR(32) NOT NULL,
  claimed_at DATETIME NOT NULL,
  PRIMARY KEY (code, player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ink_wallets (
  player_id VARCHAR(32) NOT NULL,
  ink INT NOT NULL DEFAULT 0,
  tickets INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS player_unlocks (
  player_id VARCHAR(32) NOT NULL,
  unlock_id VARCHAR(32) NOT NULL,
  granted_at DATETIME NOT NULL,
  expires_at VARCHAR(32) NOT NULL DEFAULT '',
  PRIMARY KEY (player_id, unlock_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS watch_videos (
  id VARCHAR(40) NOT NULL,
  label VARCHAR(120) NOT NULL DEFAULT '',
  duration_sec INT NOT NULL DEFAULT 60,
  active TINYINT NOT NULL DEFAULT 1,
  owner_player_id VARCHAR(32) NOT NULL DEFAULT '',
  claim_once TINYINT NOT NULL DEFAULT 0,
  show_channel TINYINT NOT NULL DEFAULT 0,
  channel_url VARCHAR(255) NOT NULL DEFAULT '',
  channel_name VARCHAR(80) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS watch_player (
  player_id VARCHAR(32) NOT NULL,
  last_claimed_at VARCHAR(32) NOT NULL DEFAULT '',
  last_video_id VARCHAR(40) NOT NULL DEFAULT '',
  last_watch_sec INT NOT NULL DEFAULT 0,
  total_watch_sec INT NOT NULL DEFAULT 0,
  hour_key VARCHAR(20) NOT NULL DEFAULT '',
  hour_coins INT NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS watch_claims (
  player_id VARCHAR(32) NOT NULL,
  video_id VARCHAR(40) NOT NULL,
  watch_sec INT NOT NULL DEFAULT 0,
  milestone_sec INT NOT NULL DEFAULT 0,
  reward INT NOT NULL DEFAULT 0,
  day_jst VARCHAR(16) NOT NULL DEFAULT '',
  claimed_at DATETIME NOT NULL,
  PRIMARY KEY (player_id, video_id, milestone_sec)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS partners (
  player_id VARCHAR(32) NOT NULL,
  credit_sec INT NOT NULL DEFAULT 0,
  total_credited INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prepaid_codes (
  code VARCHAR(32) NOT NULL,
  hours INT NOT NULL DEFAULT 0,
  label VARCHAR(80) NOT NULL DEFAULT '',
  active TINYINT NOT NULL DEFAULT 1,
  max_claims INT NOT NULL DEFAULT 1,
  claim_count INT NOT NULL DEFAULT 0,
  expires_at VARCHAR(32) NOT NULL DEFAULT '',
  created_by VARCHAR(32) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prepaid_claims (
  code VARCHAR(32) NOT NULL,
  player_id VARCHAR(32) NOT NULL,
  claimed_at DATETIME NOT NULL,
  PRIMARY KEY (code, player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS banner_assets (
  id VARCHAR(40) NOT NULL,
  owner_player_id VARCHAR(32) NOT NULL,
  image_url TEXT NOT NULL,
  width INT NOT NULL DEFAULT 320,
  height INT NOT NULL DEFAULT 80,
  href VARCHAR(255) NOT NULL DEFAULT '',
  active TINYINT NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS banner_events (
  id VARCHAR(40) NOT NULL,
  banner_id VARCHAR(40) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  player_id VARCHAR(32) NOT NULL DEFAULT '',
  billed_sec INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY banner_events_banner (banner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS banner_ink_claims (
  player_id VARCHAR(32) NOT NULL,
  banner_id VARCHAR(40) NOT NULL,
  day_jst VARCHAR(16) NOT NULL,
  claimed_at DATETIME NOT NULL,
  PRIMARY KEY (player_id, banner_id, day_jst)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS grokbuild_external_connector (
  user_id VARCHAR(32) NOT NULL,
  app_id VARCHAR(40) NOT NULL,
  proxy_url TEXT NOT NULL,
  api_key VARCHAR(120) NOT NULL DEFAULT '',
  basic_user VARCHAR(80) NOT NULL DEFAULT '',
  basic_pass VARCHAR(120) NOT NULL DEFAULT '',
  namespace VARCHAR(80) NOT NULL DEFAULT 'default',
  setup_url TEXT NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, app_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS studio_materials (
  id VARCHAR(40) NOT NULL,
  owner_id VARCHAR(32) NOT NULL,
  kind VARCHAR(24) NOT NULL,
  title VARCHAR(120) NOT NULL DEFAULT '',
  width INT NOT NULL DEFAULT 0,
  height INT NOT NULL DEFAULT 0,
  thumb_url TEXT NOT NULL,
  storage VARCHAR(16) NOT NULL DEFAULT 'remote',
  remote_snap_id INT DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY studio_materials_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webrtc_peers (
  room VARCHAR(64) NOT NULL,
  peer_id VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL DEFAULT '',
  remote_ip VARCHAR(64) NOT NULL DEFAULT '',
  last_seen DATETIME NOT NULL,
  PRIMARY KEY (room, peer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webrtc_signals (
  id BIGINT NOT NULL AUTO_INCREMENT,
  room VARCHAR(64) NOT NULL,
  to_peer VARCHAR(64) NOT NULL,
  from_peer VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY webrtc_inbox (room, to_peer, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
