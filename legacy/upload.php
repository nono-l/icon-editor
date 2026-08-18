<?php
/**
 * Icon Studio — 設置用アップローダー
 * このファイルだけ先にサーバーへ置き、ZIP を投げて展開 → install.php
 */
declare(strict_types=1);
header('Content-Type: text/html; charset=utf-8');

$ROOT = __DIR__;
$KEY_FILE = $ROOT . '/.upload-key';
$TMP = $ROOT . '/.upload-tmp';
$INSTALLED = is_file($ROOT . '/api/config.php');
$err = null;
$ok = null;
$log = [];

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function key_ok(string $file, string $pass): bool
{
    if ($pass === '' || !is_file($file)) {
        return false;
    }
    $hash = trim((string) file_get_contents($file));
    return $hash !== '' && password_verify($pass, $hash);
}

function wipe_dir(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($it as $f) {
        $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
    }
    @rmdir($dir);
}

function copy_tree(string $from, string $to, array &$log): void
{
    $from = rtrim($from, '/');
    $to = rtrim($to, '/');
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($from, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($it as $f) {
        $rel = substr($f->getPathname(), strlen($from) + 1);
        if ($rel === false || $rel === '') {
            continue;
        }
        if (str_starts_with($rel, '.upload') || $rel === 'api/config.php') {
            $log[] = 'スキップ ' . $rel;
            continue;
        }
        $dest = $to . '/' . $rel;
        if ($f->isDir()) {
            if (!is_dir($dest)) {
                mkdir($dest, 0755, true);
            }
            continue;
        }
        $dir = dirname($dest);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        if (!copy($f->getPathname(), $dest)) {
            throw new RuntimeException('書けません: ' . $rel);
        }
        $log[] = $rel;
    }
}

function find_package_root(string $dir): string
{
    $dir = rtrim($dir, '/');
    if (is_file($dir . '/install.php')) {
        return $dir;
    }
    if (is_file($dir . '/legacy/install.php')) {
        return $dir . '/legacy';
    }
    $kids = @scandir($dir) ?: [];
    foreach ($kids as $name) {
        if ($name === '.' || $name === '..') {
            continue;
        }
        $p = $dir . '/' . $name;
        if (!is_dir($p)) {
            continue;
        }
        if (is_file($p . '/install.php')) {
            return $p;
        }
        if (is_file($p . '/legacy/install.php')) {
            return $p . '/legacy';
        }
    }
    throw new RuntimeException('ZIP の中に install.php が見つかりません。legacy/ ごと、または GitHub のソースZIPを上げてください。');
}

function unzip_safe(string $zipPath, string $dest): void
{
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('この PHP に ZipArchive がありません。レンタルサーバーの PHP 設定で zip を有効にしてください。');
    }
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
        throw new RuntimeException('ZIP を開けません。壊れているか、zip ではありません。');
    }
    $destReal = realpath($dest);
    if ($destReal === false) {
        throw new RuntimeException('展開先がありません。');
    }
    $allow = ['php', 'sql', 'html', 'htm', 'js', 'css', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'json', 'md', 'txt', 'htaccess', 'ico', 'woff', 'woff2', 'map'];
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $stat = $zip->statIndex($i);
        if (!$stat) {
            continue;
        }
        $name = str_replace('\\', '/', $stat['name']);
        if ($name === '' || str_contains($name, '..') || str_starts_with($name, '/')) {
            throw new RuntimeException('危険なパスを含む ZIP です: ' . $name);
        }
        $isDir = str_ends_with($name, '/') || (($stat['external_attr'] >> 16) & 0x4000);
        if ($isDir) {
            $d = $destReal . '/' . rtrim($name, '/');
            if (!is_dir($d) && !mkdir($d, 0755, true) && !is_dir($d)) {
                throw new RuntimeException('フォルダを作れません: ' . $name);
            }
            continue;
        }
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $base = strtolower(basename($name));
        if ($base === '.htaccess') {
            $ext = 'htaccess';
        }
        if ($ext !== '' && !in_array($ext, $allow, true)) {
            continue;
        }
        $out = $destReal . '/' . $name;
        $parent = dirname($out);
        if (!is_dir($parent) && !mkdir($parent, 0755, true) && !is_dir($parent)) {
            throw new RuntimeException('フォルダを作れません: ' . $name);
        }
        $realParent = realpath($parent);
        if ($realParent === false || !str_starts_with($realParent, $destReal)) {
            throw new RuntimeException('展開先がはみ出します: ' . $name);
        }
        $stream = $zip->getStream($name);
        if ($stream === false) {
            throw new RuntimeException('読めません: ' . $name);
        }
        $fh = fopen($out, 'wb');
        if ($fh === false) {
            fclose($stream);
            throw new RuntimeException('書けません: ' . $name);
        }
        stream_copy_to_stream($stream, $fh);
        fclose($fh);
        fclose($stream);
    }
    $zip->close();
}

if ($INSTALLED && ($_POST['op'] ?? '') === 'burn') {
    $pass = (string) ($_POST['pass'] ?? '');
    if (is_file($KEY_FILE) && !key_ok($KEY_FILE, $pass)) {
        $err = '合言葉が違います。';
    } else {
        @unlink($KEY_FILE);
        @unlink(__FILE__);
        header('Location: ./');
        exit;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$INSTALLED) {
    $op = (string) ($_POST['op'] ?? 'upload');
    $pass = (string) ($_POST['pass'] ?? '');
    try {
        if ($op === 'init') {
            if (strlen($pass) < 4) {
                throw new RuntimeException('合言葉は4文字以上にしてください。');
            }
            if (is_file($KEY_FILE)) {
                throw new RuntimeException('すでに合言葉があります。');
            }
            if (file_put_contents($KEY_FILE, password_hash($pass, PASSWORD_DEFAULT)) === false) {
                throw new RuntimeException('合言葉を書けません。このフォルダの書き込み権限を確認してください。');
            }
            @chmod($KEY_FILE, 0600);
            $ok = '合言葉を覚えました。ZIP を上げてください。';
        } elseif ($op === 'upload') {
            if (!is_file($KEY_FILE)) {
                throw new RuntimeException('先に合言葉を決めてください。');
            }
            if (!key_ok($KEY_FILE, $pass)) {
                throw new RuntimeException('合言葉が違います。');
            }
            if (!isset($_FILES['zip']) || !is_array($_FILES['zip'])) {
                throw new RuntimeException('ZIP を選んでください。');
            }
            $file = $_FILES['zip'];
            if ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                $map = [
                    UPLOAD_ERR_INI_SIZE => 'ファイルが大きすぎます（php.ini の upload_max_filesize）。',
                    UPLOAD_ERR_FORM_SIZE => 'ファイルが大きすぎます。',
                    UPLOAD_ERR_PARTIAL => '途中で切れました。もう一度。',
                    UPLOAD_ERR_NO_FILE => 'ZIP を選んでください。',
                ];
                throw new RuntimeException($map[$file['error']] ?? 'アップロードに失敗しました。');
            }
            $tmp = (string) $file['tmp_name'];
            $name = (string) $file['name'];
            if (!str_ends_with(strtolower($name), '.zip')) {
                throw new RuntimeException('拡張子は .zip にしてください。');
            }
            wipe_dir($TMP);
            if (!mkdir($TMP, 0700, true) && !is_dir($TMP)) {
                throw new RuntimeException('一時フォルダを作れません。');
            }
            unzip_safe($tmp, $TMP);
            $pkg = find_package_root($TMP);
            $log[] = '展開元: ' . substr($pkg, strlen($TMP) + 1);
            copy_tree($pkg, $ROOT, $log);
            wipe_dir($TMP);
            if (!is_file($ROOT . '/install.php')) {
                throw new RuntimeException('展開しましたが install.php がありません。');
            }
            $ok = '展開しました。設置に進めます。';
        }
    } catch (Throwable $e) {
        $err = $e->getMessage();
        wipe_dir($TMP);
    }
}

$hasKey = is_file($KEY_FILE);
$ready = is_file($ROOT . '/install.php');
?>
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Icon Studio アップローダー</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background:#0b0d10; color:#e8eaed; margin:0; }
    main { max-width: 28rem; margin: 2.5rem auto; padding: 1.5rem; border:1px solid #2a3038; border-radius: 16px; background:#12151a; }
    label { display:block; font-size:12px; color:#9aa3ad; margin:12px 0 4px; }
    input[type=password], input[type=file] { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid #2a3038; background:#0b0d10; color:#e8eaed; }
    button, .btn { display:block; margin-top:16px; width:100%; padding:12px; border:0; border-radius:10px; background:#7dd3c0; color:#0b0d10; font-weight:700; text-align:center; text-decoration:none; box-sizing:border-box; }
    .ghost { background:transparent; border:1px solid #2a3038; color:#e8eaed; }
    .err { background:#3a1515; color:#ffb4b4; padding:10px; border-radius:10px; }
    .ok { background:#14302b; color:#7dd3c0; padding:10px; border-radius:10px; }
    .log { max-height:9rem; overflow:auto; font:11px/1.4 ui-monospace,monospace; color:#9aa3ad; margin-top:10px; }
    p.hint { font-size:12px; color:#9aa3ad; line-height:1.55; }
  </style>
</head>
<body>
<main>
  <p style="letter-spacing:.2em;font-size:10px;color:#7dd3c0">ICON STUDIO</p>
  <h1 style="margin:.2rem 0 1rem;font-size:1.25rem">ZIP アップローダー</h1>
  <?php if ($err): ?><p class="err"><?= h($err) ?></p><?php endif; ?>
  <?php if ($ok): ?><p class="ok"><?= h($ok) ?></p><?php endif; ?>

  <?php if ($INSTALLED): ?>
    <p class="ok">すでに設置済みです。このアップローダーは不要です。</p>
    <a class="btn" href="./">編集画面へ</a>
    <form method="post">
      <input type="hidden" name="op" value="burn" />
      <label>合言葉（残っていれば）</label>
      <input type="password" name="pass" />
      <button class="ghost" type="submit">upload.php を消す</button>
    </form>
  <?php elseif (!$hasKey): ?>
    <p class="hint">このファイルだけ先に置きました。合言葉を決めてから、アプリの ZIP を上げます。</p>
    <form method="post">
      <input type="hidden" name="op" value="init" />
      <label>合言葉</label>
      <input type="password" name="pass" required minlength="4" />
      <button type="submit">合言葉を保存</button>
    </form>
  <?php else: ?>
    <p class="hint">
      受け付ける ZIP:<br>
      · GitHub のソースZIP（中の <code>legacy/</code> を使う）<br>
      · <code>legacy/</code> フォルダを固めたもの<br>
      · <code>install.php</code> が直下にあるもの
    </p>
    <form method="post" enctype="multipart/form-data">
      <input type="hidden" name="op" value="upload" />
      <label>合言葉</label>
      <input type="password" name="pass" required />
      <label>ZIP</label>
      <input type="file" name="zip" accept=".zip,application/zip" required />
      <button type="submit">アップロードして展開</button>
    </form>
    <?php if ($ready): ?>
      <a class="btn" href="install.php">設置へ進む</a>
    <?php endif; ?>
    <?php if ($log): ?>
      <div class="log"><?php foreach ($log as $line) echo h($line) . "<br>"; ?></div>
    <?php endif; ?>
  <?php endif; ?>
</main>
</body>
</html>
