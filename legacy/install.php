<?php
declare(strict_types=1);
header('Content-Type: text/html; charset=utf-8');

$configPath = __DIR__ . '/api/config.php';
$installed = is_file($configPath);
$error = null;
$success = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $host = trim((string) ($_POST['host'] ?? 'localhost'));
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $database = trim((string) ($_POST['database'] ?? ''));
    $adminEmail = strtolower(trim((string) ($_POST['admin_email'] ?? '')));
    if ($username === '' || $database === '') {
        $error = 'ユーザー名とデータベース名は必須です。';
    } else {
        try {
            mysqli_report(MYSQLI_REPORT_OFF);
            $conn = new mysqli($host, $username, $password, $database);
            if ($conn->connect_errno) {
                throw new Exception('接続に失敗しました: ' . $conn->connect_error);
            }
            $conn->set_charset('utf8mb4');
            $sql = file_get_contents(__DIR__ . '/install/schema.sql');
            if ($sql === false) {
                throw new Exception('schema.sql がありません。');
            }
            if (!$conn->multi_query($sql)) {
                throw new Exception('SQL 実行に失敗: ' . $conn->error);
            }
            while ($conn->more_results() && $conn->next_result()) {
                /* drain */
            }
            $sample = file_get_contents(__DIR__ . '/api/config.sample.php');
            if ($sample === false) {
                throw new Exception('config.sample.php がありません。');
            }
            $out = str_replace(
                [
                    "define('DB_HOST', 'localhost');",
                    "define('DB_NAME', 'icon_studio');",
                    "define('DB_USER', 'icon_studio');",
                    "define('DB_PASS', 'CHANGE_ME');",
                    "define('ADMIN_EMAIL', '');",
                ],
                [
                    "define('DB_HOST', '" . addslashes($host) . "');",
                    "define('DB_NAME', '" . addslashes($database) . "');",
                    "define('DB_USER', '" . addslashes($username) . "');",
                    "define('DB_PASS', '" . addslashes($password) . "');",
                    "define('ADMIN_EMAIL', '" . addslashes($adminEmail) . "');",
                ],
                $sample
            );
            if (file_put_contents($configPath, $out) === false) {
                throw new Exception('api/config.php を書けません。パーミッションを確認してください。');
            }
            $success = true;
            $installed = true;
        } catch (Throwable $e) {
            $error = $e->getMessage();
        }
    }
}
?>
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Icon Studio インストール</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background:#0b0d10; color:#e8eaed; margin:0; }
    main { max-width: 28rem; margin: 3rem auto; padding: 1.5rem; border:1px solid #2a3038; border-radius: 16px; background:#12151a; }
    label { display:block; font-size:12px; color:#9aa3ad; margin:12px 0 4px; }
    input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid #2a3038; background:#0b0d10; color:#e8eaed; }
    button { margin-top:18px; width:100%; padding:12px; border:0; border-radius:10px; background:#7dd3c0; color:#0b0d10; font-weight:700; }
    .err { background:#3a1515; color:#ffb4b4; padding:10px; border-radius:10px; }
    .ok { background:#14302b; color:#7dd3c0; padding:10px; border-radius:10px; }
    a { color:#7dd3c0; }
  </style>
</head>
<body>
<main>
  <p style="letter-spacing:.2em;font-size:10px;color:#7dd3c0">ICON STUDIO</p>
  <h1 style="margin:.2rem 0 1rem;font-size:1.4rem">レガシーサーバー設置</h1>
  <?php if ($success): ?>
    <p class="ok">インストールできました。最初に登録した（または指定した）メールが管理者になります。</p>
    <p><a href="./">編集画面を開く</a></p>
  <?php elseif ($installed && $_SERVER['REQUEST_METHOD'] !== 'POST'): ?>
    <p class="ok">すでに config.php があります。</p>
    <p><a href="./">編集画面へ</a></p>
  <?php else: ?>
    <?php if ($error): ?><p class="err"><?= htmlspecialchars($error, ENT_QUOTES) ?></p><?php endif; ?>
    <form method="post">
      <label>MySQL ホスト</label>
      <input name="host" value="localhost" required />
      <label>ユーザー名</label>
      <input name="username" required />
      <label>パスワード</label>
      <input name="password" type="password" />
      <label>データベース名</label>
      <input name="database" required />
      <label>管理者メール（任意・最初の登録者も管理者）</label>
      <input name="admin_email" type="email" />
      <button type="submit">インストール</button>
    </form>
  <?php endif; ?>
</main>
</body>
</html>
