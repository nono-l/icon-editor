# Icon Studio — レガシーサーバー設置（React + PHP + MySQL）

Vercel は使いません。レンタルサーバー（Apache + PHP + MySQL）に FTP / ファイルマネージャで置けます。

フロントは **ビルド済みの React**（Babel/ESBuild で変換済み）です。サーバーに Node は不要です。

## 0. ファイルマネージャに1枚だけ置く

1. [`upload.php`](upload.php) だけをサーバーの公開フォルダへ置く
2. `https://あなたのドメイン/upload.php` を開く
3. 合言葉を決める
4. 次のいずれかの ZIP を上げる
   - GitHub の **Code → Download ZIP**（中の `legacy/` を自動で拾う）
   - `legacy/` フォルダを固めた ZIP
   - `install.php` が直下にある ZIP
5. 「設置へ進む」→ `install.php`

設置が終わったら、同じ画面から `upload.php` を消してください。


```bash
npm install
npm run build:legacy
```

`legacy/app/app.js` と `legacy/app/index.html` ができます。

## 2. サーバーへアップロード

`legacy/` の中身をドキュメントルートへ。例:

```
/public_html/
  install.php
  index.php
  .htaccess
  api/
  install/
  app/
```

`mod_rewrite` を有効にしてください。

## 3. ブラウザでインストール

`https://あなたのドメイン/install.php`

MySQL のホスト・ユーザー・パスワード・DB名を入れると `api/config.php` が書かれ、テーブルが作られます。

最初に登録したアカウント（または指定した管理者メール）が管理者です。

## 4. 動くもの

- アイコン／バナー編集
- みんなで編集（P2P 本線、届かないときは **短いポーリング** のサーバー経由）
- メール＋パスワードログイン
- プロモコード、インク、チケット、外部ストレージ設定 API

長い SSE は使いません。PHP のプロセスを張りっぱなしにしないので、Vercel の時間課金も共用サーバーの同時接続も節約できます。

## 注意

- `api/config.php` は公開しない（インストール後に書けます）
- 大きな画像のサーバー経由同期は、共用サーバーの POST 上限に当たることがあります
- 開発中のプレビュー（Grok / Vite）は今までどおり Node です。本番だけこの `legacy/` を使います
