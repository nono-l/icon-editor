<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
studio_cors();
studio_load_config();

$pdo = studio_pdo();
$idRe = '/^[a-zA-Z0-9_-]{1,64}$/';
$peerTtl = defined('PEER_TTL_SECONDS') ? (int) PEER_TTL_SECONDS : 30;
$signalTtl = defined('SIGNAL_TTL_SECONDS') ? (int) SIGNAL_TTL_SECONDS : 60;
$maxBytes = defined('MAX_SIGNAL_BYTES') ? (int) MAX_SIGNAL_BYTES : 32768;

function rtc_prune(PDO $pdo, int $peerTtl, int $signalTtl): void
{
    $pdo->prepare('DELETE FROM webrtc_peers WHERE last_seen < (UTC_TIMESTAMP() - INTERVAL ? SECOND)')
        ->execute([$peerTtl]);
    $pdo->prepare('DELETE FROM webrtc_signals WHERE created_at < (UTC_TIMESTAMP() - INTERVAL ? SECOND)')
        ->execute([$signalTtl]);
}

function rtc_touch(PDO $pdo, string $room, string $peer, string $name, string $ip): void
{
    $st = $pdo->prepare(
        'INSERT INTO webrtc_peers (room, peer_id, name, remote_ip, last_seen)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE name = VALUES(name), remote_ip = VALUES(remote_ip), last_seen = UTC_TIMESTAMP()'
    );
    $st->execute([$room, $peer, $name, $ip]);
}

function rtc_roster(PDO $pdo, string $room, string $selfIp, int $peerTtl): array
{
    $st = $pdo->prepare(
        'SELECT peer_id, name, remote_ip FROM webrtc_peers
         WHERE room = ? AND last_seen > (UTC_TIMESTAMP() - INTERVAL ? SECOND)
         ORDER BY peer_id LIMIT 32'
    );
    $st->execute([$room, $peerTtl]);
    $out = [];
    foreach ($st as $row) {
        $out[] = [
            'id' => $row['peer_id'],
            'name' => $row['name'],
            'sameIp' => ($row['remote_ip'] !== '' && $row['remote_ip'] === $selfIp),
        ];
    }
    return $out;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $room = (string) ($_GET['room'] ?? '');
    $peer = (string) ($_GET['peer'] ?? '');
    $name = mb_substr((string) ($_GET['name'] ?? ''), 0, 64);
    $since = (int) ($_GET['since'] ?? 0);
    if (!preg_match($idRe, $room) || !preg_match($idRe, $peer) || $since < 0) {
        studio_json(['error' => 'invalid query'], 400);
    }
    if ($since === 0 || random_int(0, 49) === 0) {
        rtc_prune($pdo, $peerTtl, $signalTtl);
    }
    $ip = studio_client_ip();
    rtc_touch($pdo, $room, $peer, $name, $ip);
    $st = $pdo->prepare(
        'SELECT id, from_peer, kind, payload FROM webrtc_signals
         WHERE room = ? AND to_peer = ? AND id > ?
         ORDER BY id LIMIT 200'
    );
    $st->execute([$room, $peer, $since]);
    $signals = [];
    foreach ($st as $row) {
        $payload = $row['payload'];
        if (is_string($payload)) {
            $decoded = json_decode($payload, true);
            $payload = $decoded === null ? $payload : $decoded;
        }
        $signals[] = [
            'id' => (int) $row['id'],
            'from' => $row['from_peer'],
            'kind' => $row['kind'],
            'payload' => $payload,
        ];
    }
    studio_json([
        'peers' => rtc_roster($pdo, $room, $ip, $peerTtl),
        'signals' => $signals,
    ]);
}

if ($method !== 'POST') {
    studio_json(['error' => 'method not allowed'], 405);
}

$msg = studio_read_json();
$op = (string) ($msg['op'] ?? '');

if ($op === 'signal') {
    $room = (string) ($msg['room'] ?? '');
    $from = (string) ($msg['from'] ?? '');
    $to = (string) ($msg['to'] ?? '');
    $kind = (string) ($msg['kind'] ?? '');
    if (
        !preg_match($idRe, $room) ||
        !preg_match($idRe, $from) ||
        !preg_match($idRe, $to) ||
        !in_array($kind, ['offer', 'answer', 'ice', 'lan', 'bus'], true)
    ) {
        studio_json(['error' => 'invalid request'], 400);
    }
    if (!array_key_exists('payload', $msg)) {
        studio_json(['error' => 'invalid request'], 400);
    }
    $encoded = json_encode($msg['payload'], JSON_UNESCAPED_UNICODE);
    if ($encoded === false || strlen($encoded) > $maxBytes) {
        studio_json(['error' => 'payload too large'], 400);
    }
    $pdo->prepare(
        'INSERT INTO webrtc_signals (room, to_peer, from_peer, kind, payload, created_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())'
    )->execute([$room, $to, $from, $kind, $encoded]);
    studio_json(['ok' => true]);
}

if ($op === 'bus') {
    $room = (string) ($msg['room'] ?? '');
    $from = (string) ($msg['from'] ?? '');
    if (!preg_match($idRe, $room) || !preg_match($idRe, $from) || !array_key_exists('payload', $msg)) {
        studio_json(['error' => 'invalid request'], 400);
    }
    $encoded = json_encode($msg['payload'], JSON_UNESCAPED_UNICODE);
    if ($encoded === false || strlen($encoded) > $maxBytes) {
        studio_json(['error' => 'payload too large'], 400);
    }
    $st = $pdo->prepare(
        'SELECT peer_id FROM webrtc_peers
         WHERE room = ? AND peer_id <> ? AND last_seen > (UTC_TIMESTAMP() - INTERVAL ? SECOND)'
    );
    $st->execute([$room, $from, $peerTtl]);
    $n = 0;
    $ins = $pdo->prepare(
        'INSERT INTO webrtc_signals (room, to_peer, from_peer, kind, payload, created_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())'
    );
    foreach ($st as $row) {
        $ins->execute([$room, $row['peer_id'], $from, 'bus', $encoded]);
        $n++;
    }
    studio_json(['ok' => true, 'n' => $n]);
}

if ($op === 'leave') {
    $room = (string) ($msg['room'] ?? '');
    $peer = (string) ($msg['peer'] ?? '');
    if (!preg_match($idRe, $room) || !preg_match($idRe, $peer)) {
        studio_json(['error' => 'invalid request'], 400);
    }
    $pdo->prepare('DELETE FROM webrtc_peers WHERE room = ? AND peer_id = ?')->execute([$room, $peer]);
    studio_json(['ok' => true]);
}

studio_json(['error' => 'invalid request'], 400);
