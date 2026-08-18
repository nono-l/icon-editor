<?php
declare(strict_types=1);

function studio_config_path(): string
{
    return __DIR__ . '/config.php';
}

function studio_load_config(): void
{
    $path = studio_config_path();
    if (!is_file($path)) {
        throw new RuntimeException('api/config.php がありません。install.php を実行してください。');
    }
    require_once $path;
}

function studio_client_ip(): string
{
    if (defined('TRUST_PROXY') && TRUST_PROXY) {
        $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        if (is_string($xff) && $xff !== '') {
            $parts = array_map('trim', explode(',', $xff));
            if ($parts[0] !== '' && filter_var($parts[0], FILTER_VALIDATE_IP)) {
                return $parts[0];
            }
        }
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return is_string($ip) ? $ip : '0.0.0.0';
}

function studio_pdo(): PDO
{
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        DB_HOST,
        DB_NAME,
        defined('DB_CHARSET') ? DB_CHARSET : 'utf8mb4'
    );
    return new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function studio_json(mixed $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function studio_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (is_string($origin) && $origin !== '') {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Headers: content-type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function studio_read_json(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') {
        return $_POST;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function studio_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function studio_nid(string $prefix = 'u'): string
{
    return $prefix . bin2hex(random_bytes(5));
}

function studio_jst_day(): string
{
    $tz = new DateTimeZone('Asia/Tokyo');
    return (new DateTimeImmutable('now', $tz))->format('Y-m-d');
}

function studio_jst_hour(): string
{
    $tz = new DateTimeZone('Asia/Tokyo');
    return (new DateTimeImmutable('now', $tz))->format('Y-m-d-H');
}
