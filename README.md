# Devotion 70

iPhone向けの聖書通読スケジュール静的ページです。

- Pages URL: https://kizuna42.github.io/Devotion/
- Source: M28 Bible passage list
- Initial completed days: 2026-04-26 to 2026-04-28


## 開発

ビルド不要の静的ページです。`index.html` をブラウザで開くか、ローカルサーバーで確認します。

```sh
python3 -m http.server 8000   # http://localhost:8000/
```

進捗はブラウザの `localStorage`（キー `devotionBibleSchedule:v2:completed`）に保存されます。

## テスト

Node.js 18 以上で、依存パッケージなしに実行できます。スケジュールデータの整合性（日付・曜日の連続性など）と、ページスクリプトの動作を確認します。

```sh
node tests/check.mjs
```

GitHub Actions（`.github/workflows/ci.yml`）で push / PR ごとに同じチェックが走ります。
