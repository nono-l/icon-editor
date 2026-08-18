<?php
declare(strict_types=1);
if (!is_file(__DIR__ . '/api/config.php')) {
    header('Location: install.php');
    exit;
}
$html = __DIR__ . '/app/index.html';
if (!is_file($html)) {
    header('Content-Type: text/plain; charset=utf-8');
    echo "app/index.html がありません。リポジトリで npm run build:legacy を実行してから、legacy/ をアップロードしてください。\n";
    exit;
}
header('Content-Type: text/html; charset=utf-8');
readfile($html);
