<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
studio_cors();
studio_load_config();
$pdo = studio_pdo();

function fn_user(PDO $pdo): ?array
{
    $sid = $_COOKIE['studio_sid'] ?? '';
    if (!is_string($sid) || $sid === '') {
        return null;
    }
    $st = $pdo->prepare(
        'SELECT u.id, u.email, u.name
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > UTC_TIMESTAMP() LIMIT 1'
    );
    $st->execute([$sid]);
    $row = $st->fetch();
    return $row ?: null;
}

function fn_need_user(PDO $pdo): array
{
    $u = fn_user($pdo);
    if (!$u) {
        studio_json(['error' => 'auth'], 401);
    }
    return $u;
}

function fn_is_staff(PDO $pdo, string $uid): bool
{
    $st = $pdo->prepare('SELECT 1 FROM game_admins WHERE player_id = ? LIMIT 1');
    $st->execute([$uid]);
    return (bool) $st->fetchColumn();
}

function fn_wallet(PDO $pdo, string $uid): array
{
    $st = $pdo->prepare('SELECT ink, tickets FROM ink_wallets WHERE player_id = ? LIMIT 1');
    $st->execute([$uid]);
    $row = $st->fetch() ?: ['ink' => 0, 'tickets' => 0];
    return ['ink' => (int) $row['ink'], 'tickets' => (int) $row['tickets']];
}

function fn_unlocks(PDO $pdo, string $uid): array
{
    $st = $pdo->prepare('SELECT unlock_id, expires_at FROM player_unlocks WHERE player_id = ?');
    $st->execute([$uid]);
    $ids = [];
    $until = [];
    $now = time();
    foreach ($st as $row) {
        $exp = (string) $row['expires_at'];
        if ($exp !== '' && strtotime($exp) !== false && strtotime($exp) < $now) {
            continue;
        }
        $ids[] = $row['unlock_id'];
        if ($exp !== '') {
            $until[$row['unlock_id']] = $exp;
        }
    }
    return [$ids, $until];
}

function fn_apply_grant(PDO $pdo, string $uid, array $grant): void
{
    $pdo->prepare(
        'INSERT INTO ink_wallets (player_id, ink, tickets, updated_at)
         VALUES (?, 0, 0, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE player_id = player_id'
    )->execute([$uid]);
    $ink = (int) ($grant['ink'] ?? 0);
    $tickets = (int) ($grant['tickets'] ?? 0);
    if ($ink || $tickets) {
        $pdo->prepare(
            'UPDATE ink_wallets SET ink = ink + ?, tickets = tickets + ?, updated_at = UTC_TIMESTAMP()
             WHERE player_id = ?'
        )->execute([$ink, $tickets, $uid]);
    }
    $unlocks = $grant['unlocks'] ?? [];
    if (is_array($unlocks)) {
        $exp = date('c', time() + 90 * 86400);
        $ins = $pdo->prepare(
            'INSERT INTO player_unlocks (player_id, unlock_id, granted_at, expires_at)
             VALUES (?, ?, UTC_TIMESTAMP(), ?)
             ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), granted_at = UTC_TIMESTAMP()'
        );
        foreach ($unlocks as $id) {
            if (is_string($id) && $id !== '') {
                $ins->execute([$uid, $id, $exp]);
            }
        }
    }
}

$body = studio_read_json();
$fn = (string) ($body['fn'] ?? $_GET['fn'] ?? '');
$data = $body['data'] ?? null;

try {
    switch ($fn) {
        case 'getMyStudio': {
            $u = fn_need_user($pdo);
            [$unlocks, $until] = fn_unlocks($pdo, $u['id']);
            $w = fn_wallet($pdo, $u['id']);
            $hourKey = studio_jst_hour();
            $hp = $pdo->prepare('SELECT hour_key, hour_coins FROM watch_player WHERE player_id = ? LIMIT 1');
            $hp->execute([$u['id']]);
            $h = $hp->fetch();
            $hourInk = ($h && $h['hour_key'] === $hourKey) ? (int) $h['hour_coins'] : 0;
            $cr = $pdo->prepare('SELECT credit_sec FROM partners WHERE player_id = ? LIMIT 1');
            $cr->execute([$u['id']]);
            $c = $cr->fetch();
            $conn = $pdo->prepare(
                'SELECT enabled FROM grokbuild_external_connector WHERE user_id = ? AND enabled = 1 LIMIT 1'
            );
            $conn->execute([$u['id']]);
            studio_json(['data' => [
                'signedIn' => true,
                'userId' => $u['id'],
                'ink' => $w['ink'],
                'tickets' => $w['tickets'],
                'unlocks' => $unlocks,
                'unlockUntil' => $until,
                'isStaff' => fn_is_staff($pdo, $u['id']),
                'isSuper' => fn_is_staff($pdo, $u['id']),
                'hourInk' => $hourInk,
                'hourCap' => 4,
                'creditSec' => $c ? (int) $c['credit_sec'] : 0,
                'storage' => $conn->fetch() ? 'remote' : 'none',
            ]]);
        }

        case 'claimPromo': {
            $u = fn_need_user($pdo);
            $code = strtoupper(preg_replace('/[^A-Z0-9_-]/', '', (string) $data));
            if (strlen($code) < 2) {
                studio_json(['data' => ['ok' => false, 'reason' => 'invalid']]);
            }
            $had = $pdo->prepare('SELECT 1 FROM promo_claims WHERE code = ? AND player_id = ?');
            $had->execute([$code, $u['id']]);
            if ($had->fetch()) {
                studio_json(['data' => ['ok' => false, 'reason' => 'already']]);
            }
            $st = $pdo->prepare('SELECT grant_json, active, expires_at, max_claims FROM promo_codes WHERE code = ?');
            $st->execute([$code]);
            $row = $st->fetch();
            if (!$row || !(int) $row['active']) {
                studio_json(['data' => ['ok' => false, 'reason' => 'missing']]);
            }
            $grant = json_decode((string) $row['grant_json'], true) ?: [];
            fn_apply_grant($pdo, $u['id'], $grant);
            $pdo->prepare('INSERT INTO promo_claims (code, player_id, claimed_at) VALUES (?, ?, UTC_TIMESTAMP())')
                ->execute([$code, $u['id']]);
            studio_json(['data' => ['ok' => true, 'grant' => $grant]]);
        }

        case 'buyUnlock': {
            $u = fn_need_user($pdo);
            $id = is_array($data) ? (string) ($data['id'] ?? '') : (string) $data;
            $prices = ['size512' => 2, 'size1024' => 4, 'apple' => 2, 'palette' => 3];
            if (!isset($prices[$id])) {
                studio_json(['data' => ['ok' => false, 'reason' => 'unknown']]);
            }
            $w = fn_wallet($pdo, $u['id']);
            if ($w['ink'] < $prices[$id]) {
                studio_json(['data' => ['ok' => false, 'reason' => 'ink']]);
            }
            $pdo->prepare('UPDATE ink_wallets SET ink = ink - ?, updated_at = UTC_TIMESTAMP() WHERE player_id = ?')
                ->execute([$prices[$id], $u['id']]);
            fn_apply_grant($pdo, $u['id'], ['unlocks' => [$id]]);
            studio_json(['data' => ['ok' => true]]);
        }

        case 'listPublicBanners': {
            $st = $pdo->query(
                'SELECT id, image_url, width, height, href FROM banner_assets WHERE active = 1 ORDER BY priority DESC, created_at DESC LIMIT 12'
            );
            studio_json(['data' => $st->fetchAll()]);
        }

        case 'recordBannerEvent': {
            $u = fn_user($pdo);
            $banner = is_array($data) ? (string) ($data['bannerId'] ?? $data['id'] ?? '') : '';
            $kind = is_array($data) ? (string) ($data['kind'] ?? 'click') : 'click';
            if ($banner === '') {
                studio_json(['data' => ['ok' => false]]);
            }
            $pdo->prepare(
                'INSERT INTO banner_events (id, banner_id, kind, player_id, billed_sec, created_at)
                 VALUES (?, ?, ?, ?, 0, UTC_TIMESTAMP())'
            )->execute([studio_nid('be'), $banner, $kind, $u['id'] ?? '']);
            studio_json(['data' => ['ok' => true]]);
        }

        case 'claimBannerInk': {
            $u = fn_need_user($pdo);
            $banner = is_array($data) ? (string) ($data['bannerId'] ?? $data['id'] ?? '') : (string) $data;
            $day = studio_jst_day();
            try {
                $pdo->prepare(
                    'INSERT INTO banner_ink_claims (player_id, banner_id, day_jst, claimed_at)
                     VALUES (?, ?, ?, UTC_TIMESTAMP())'
                )->execute([$u['id'], $banner, $day]);
            } catch (PDOException $e) {
                studio_json(['data' => ['ok' => false, 'reason' => 'already']]);
            }
            fn_apply_grant($pdo, $u['id'], ['ink' => 1]);
            studio_json(['data' => ['ok' => true, 'ink' => 1]]);
        }

        case 'listWatchCatalog': {
            $st = $pdo->query(
                'SELECT id, label, duration_sec, show_channel, channel_url, channel_name
                 FROM watch_videos WHERE active = 1 ORDER BY created_at DESC LIMIT 40'
            );
            studio_json(['data' => $st->fetchAll()]);
        }

        case 'claimWatch': {
            $u = fn_need_user($pdo);
            $video = is_array($data) ? (string) ($data['videoId'] ?? $data['id'] ?? '') : (string) $data;
            if ($video === '') {
                studio_json(['data' => ['ok' => false, 'reason' => 'invalid']]);
            }
            fn_apply_grant($pdo, $u['id'], ['tickets' => 1]);
            $pdo->prepare(
                'INSERT INTO watch_claims (player_id, video_id, watch_sec, milestone_sec, reward, day_jst, claimed_at)
                 VALUES (?, ?, 0, 0, 1, ?, UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE reward = reward + 1'
            )->execute([$u['id'], $video, studio_jst_day()]);
            studio_json(['data' => ['ok' => true, 'tickets' => 1]]);
        }

        case 'getConnectorSettings': {
            $u = fn_need_user($pdo);
            if (!fn_is_staff($pdo, $u['id'])) {
                studio_json(['error' => 'forbidden'], 403);
            }
            $st = $pdo->prepare(
                'SELECT proxy_url, api_key, basic_user, basic_pass, namespace, setup_url, enabled
                 FROM grokbuild_external_connector WHERE user_id = ? AND app_id = ? LIMIT 1'
            );
            $st->execute([$u['id'], 'icon-studio']);
            $row = $st->fetch() ?: [
                'proxy_url' => '', 'api_key' => '', 'basic_user' => '', 'basic_pass' => '',
                'namespace' => 'default', 'setup_url' => '', 'enabled' => 0,
            ];
            $row['enabled'] = (bool) (int) $row['enabled'];
            studio_json(['data' => $row]);
        }

        case 'saveConnectorSettings': {
            $u = fn_need_user($pdo);
            if (!fn_is_staff($pdo, $u['id'])) {
                studio_json(['error' => 'forbidden'], 403);
            }
            $d = is_array($data) ? $data : [];
            $pdo->prepare(
                'INSERT INTO grokbuild_external_connector
                 (user_id, app_id, proxy_url, api_key, basic_user, basic_pass, namespace, setup_url, enabled, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE
                   proxy_url = VALUES(proxy_url), api_key = VALUES(api_key),
                   basic_user = VALUES(basic_user), basic_pass = VALUES(basic_pass),
                   namespace = VALUES(namespace), setup_url = VALUES(setup_url),
                   enabled = VALUES(enabled), updated_at = UTC_TIMESTAMP()'
            )->execute([
                $u['id'],
                'icon-studio',
                (string) ($d['proxy_url'] ?? $d['proxyUrl'] ?? ''),
                (string) ($d['api_key'] ?? $d['apiKey'] ?? ''),
                (string) ($d['basic_user'] ?? $d['basicUser'] ?? ''),
                (string) ($d['basic_pass'] ?? $d['basicPass'] ?? ''),
                (string) ($d['namespace'] ?? 'default'),
                (string) ($d['setup_url'] ?? $d['setupUrl'] ?? ''),
                !empty($d['enabled']) ? 1 : 0,
            ]);
            studio_json(['data' => ['ok' => true]]);
        }

        case 'listPromosAdmin': {
            $u = fn_need_user($pdo);
            if (!fn_is_staff($pdo, $u['id'])) {
                studio_json(['error' => 'forbidden'], 403);
            }
            $st = $pdo->query('SELECT code, label, grant_json, active, expires_at, max_claims, created_at FROM promo_codes ORDER BY created_at DESC');
            studio_json(['data' => $st->fetchAll()]);
        }

        case 'savePromo': {
            $u = fn_need_user($pdo);
            if (!fn_is_staff($pdo, $u['id'])) {
                studio_json(['error' => 'forbidden'], 403);
            }
            $d = is_array($data) ? $data : [];
            $code = strtoupper(preg_replace('/[^A-Z0-9_-]/', '', (string) ($d['code'] ?? '')));
            if ($code === '') {
                studio_json(['data' => ['ok' => false]]);
            }
            $grant = json_encode($d['grant'] ?? $d['grant_json'] ?? new stdClass(), JSON_UNESCAPED_UNICODE);
            $pdo->prepare(
                'INSERT INTO promo_codes (code, label, grant_json, active, created_by, created_at, updated_at, expires_at, max_claims)
                 VALUES (?, ?, ?, 1, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?)
                 ON DUPLICATE KEY UPDATE label = VALUES(label), grant_json = VALUES(grant_json),
                   expires_at = VALUES(expires_at), max_claims = VALUES(max_claims), updated_at = UTC_TIMESTAMP()'
            )->execute([
                $code,
                (string) ($d['label'] ?? ''),
                $grant,
                $u['id'],
                (string) ($d['expires_at'] ?? $d['expiresAt'] ?? ''),
                (int) ($d['max_claims'] ?? $d['maxClaims'] ?? 0),
            ]);
            studio_json(['data' => ['ok' => true, 'code' => $code]]);
        }

        case 'getOpsOverview': {
            $u = fn_need_user($pdo);
            if (!fn_is_staff($pdo, $u['id'])) {
                studio_json(['error' => 'forbidden'], 403);
            }
            $peers = (int) $pdo->query('SELECT COUNT(*) FROM webrtc_peers WHERE last_seen > (UTC_TIMESTAMP() - INTERVAL 30 SECOND)')->fetchColumn();
            $users = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
            studio_json(['data' => [
                'users' => $users,
                'livePeers' => $peers,
                'promos' => (int) $pdo->query('SELECT COUNT(*) FROM promo_codes WHERE active = 1')->fetchColumn(),
            ]]);
        }

        case 'getStaffDesk': {
            $u = fn_need_user($pdo);
            studio_json(['data' => [
                'isStaff' => fn_is_staff($pdo, $u['id']),
                'isSuper' => fn_is_staff($pdo, $u['id']),
            ]]);
        }

        case 'listMaterials': {
            $u = fn_need_user($pdo);
            $st = $pdo->prepare(
                'SELECT id, kind, title, width, height, thumb_url, status, created_at
                 FROM studio_materials WHERE owner_id = ? ORDER BY created_at DESC LIMIT 80'
            );
            $st->execute([$u['id']]);
            studio_json(['data' => $st->fetchAll()]);
        }

        case 'beginMaterialRegister':
        case 'finishMaterialRegister':
        case 'cancelMaterialRegister':
            studio_json(['data' => ['ok' => false, 'reason' => 'no_store']]);

        default:
            studio_json(['error' => 'unknown fn', 'fn' => $fn], 404);
    }
} catch (Throwable $e) {
    studio_json(['error' => 'server', 'detail' => $e->getMessage()], 500);
}
