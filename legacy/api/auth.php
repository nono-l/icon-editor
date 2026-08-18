<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
studio_cors();
studio_load_config();
$pdo = studio_pdo();

$days = defined('SESSION_DAYS') ? (int) SESSION_DAYS : 14;
$cookie = 'studio_sid';

function auth_user(PDO $pdo, string $cookie): ?array
{
    $sid = $_COOKIE[$cookie] ?? '';
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

function auth_set_cookie(string $cookie, string $sid, int $days): void
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    setcookie($cookie, $sid, [
        'expires' => time() + $days * 86400,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

$op = (string) ($_GET['op'] ?? '');
$body = studio_read_json();
if ($op === '' && isset($body['op'])) {
    $op = (string) $body['op'];
}

if ($op === 'me') {
    $u = auth_user($pdo, $cookie);
    studio_json(['user' => $u ? [
        'id' => $u['id'],
        'displayName' => $u['name'] ?: explode('@', $u['email'])[0],
        'primaryEmail' => $u['email'],
        'profileImageUrl' => null,
        'isDevFallback' => false,
    ] : null]);
}

if ($op === 'register' || $op === 'login') {
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $pass = (string) ($body['password'] ?? '');
    $name = trim((string) ($body['name'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($pass) < 6) {
        studio_json(['error' => 'invalid'], 400);
    }
    if ($op === 'register') {
        $exists = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $exists->execute([$email]);
        if ($exists->fetch()) {
            studio_json(['error' => 'exists'], 409);
        }
        $id = studio_nid('u');
        $pdo->prepare(
            'INSERT INTO users (id, email, pass_hash, name, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())'
        )->execute([$id, $email, password_hash($pass, PASSWORD_DEFAULT), mb_substr($name !== '' ? $name : explode('@', $email)[0], 0, 64)]);
        $count = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        if ($count === 1 || (defined('ADMIN_EMAIL') && strcasecmp(ADMIN_EMAIL, $email) === 0)) {
            $pdo->prepare(
                'INSERT IGNORE INTO game_admins (player_id, label, appointed_by, created_at)
                 VALUES (?, ?, ?, UTC_TIMESTAMP())'
            )->execute([$id, 'owner', $id]);
        }
        $pdo->prepare(
            'INSERT IGNORE INTO ink_wallets (player_id, ink, tickets, updated_at)
             VALUES (?, 0, 0, UTC_TIMESTAMP())'
        )->execute([$id]);
    } else {
        $st = $pdo->prepare('SELECT id, pass_hash, name, email FROM users WHERE email = ? LIMIT 1');
        $st->execute([$email]);
        $row = $st->fetch();
        if (!$row || !password_verify($pass, $row['pass_hash'])) {
            studio_json(['error' => 'auth'], 401);
        }
        $id = $row['id'];
        $name = $row['name'];
        $email = $row['email'];
    }
    $sid = bin2hex(random_bytes(24));
    $pdo->prepare(
        'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))'
    )->execute([$sid, $id, $days]);
    auth_set_cookie($cookie, $sid, $days);
    studio_json([
        'user' => [
            'id' => $id,
            'displayName' => $name !== '' ? $name : explode('@', $email)[0],
            'primaryEmail' => $email,
            'profileImageUrl' => null,
            'isDevFallback' => false,
        ],
    ]);
}

if ($op === 'logout') {
    $sid = $_COOKIE[$cookie] ?? '';
    if (is_string($sid) && $sid !== '') {
        $pdo->prepare('DELETE FROM sessions WHERE id = ?')->execute([$sid]);
    }
    auth_set_cookie($cookie, '', -1);
    studio_json(['ok' => true]);
}

studio_json(['error' => 'invalid request'], 400);
