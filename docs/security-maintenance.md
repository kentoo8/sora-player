# セキュリティ保守

## 2026-10-22 の確認

- 依存パッケージを既存の指定範囲内で更新した。Next.js と eslint-config-next は 16.4.2、Express は 5.3.0、PostCSS は 8.5.31。
- `npm audit --omit=dev` は 0 件。これは npm パッケージの監査であり、Node.js 本体の安全性を保証しない。
- 開発用依存を含む `npm audit` は High 5 件。ESLint 設定から `fast-glob` / `micromatch` を経由する `braces` の同一問題が、依存元にも計上される。
- `braces` の最新公開版 3.0.3 は影響範囲に含まれ、修正版は未公開。対象は深く入れ子になったパターンの処理によるスタック枯渇。監査結果を消すための eslint-config-next 14 系へのダウングレードは行わない。
- Node.js は Homebrew 管理の 26.12.0。`brew update` 後も提供版は 26.12.0 で、26.12.1 への本体更新は未完了。
- 更新後の検証は `npm test`（26 件）、`npm run lint`、`npm run build` が成功。ビルドではローカルファイル参照に伴う Turbopack の既知の警告が出る。ブラウザでの操作確認は未実施。

Node.js の修正内容は [公式の2026年10月セキュリティ告知](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)、開発用依存の未修正問題は [braces の告知](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) を参照。

## 更新後の確認

依存関係の再現にはロックファイルを使う。`npm ci` は既存の node_modules を入れ替える。

```bash
npm ci
npm audit
npm audit --omit=dev
npm test
npm run lint
npm run build
```

ブラウザでは、動画一覧・検索・再生・音声・タグ編集を確認する。コマンドでの検証だけではブラウザ動作確認済みとは扱わない。

## Node.js 本体の残作業

Homebrew に修正版が反映されたら、次の順に更新し、起動中のプレイヤーを終了して再起動する。

```bash
brew update
brew info node
brew upgrade node
node --version
```

今回の26系の修正版は 26.12.1。将来の更新では、提供されるメジャーバージョンも確認してから更新する。
