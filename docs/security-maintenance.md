# セキュリティ保守

## 2026-10-22 の確認

- 依存パッケージを既存の指定範囲内で更新した。Next.js と eslint-config-next は 16.4.2、Express は 5.3.0、PostCSS は 8.5.31。
- `npm audit --omit=dev` は 0 件。これは npm パッケージの監査であり、Node.js 本体の安全性を保証しない。
- 開発用依存を含む `npm audit` は High 5 件。ESLint 設定から `fast-glob` / `micromatch` を経由する `braces` の同一問題が、依存元にも計上される。
- `braces` の最新公開版 3.0.3 は影響範囲に含まれ、修正版は未公開。対象は深く入れ子になったパターンの処理によるスタック枯渇。監査結果を消すための eslint-config-next 14 系へのダウングレードは行わない。
- Homebrew の提供版は `brew update` 後も 26.12.0 のため、mise で公式配布の Node.js 26.12.1 を導入し、`mise.toml` でプロジェクトに固定した。Homebrew 版は残している。
- 更新後の検証は Node.js 26.12.1 で `npm test`（26 件）、`npm run lint`、`npm run build` が成功。ビルドではローカルファイル参照に伴う Turbopack の既知の警告が出る。Mac 起動スクリプトの構文確認は成功。ブラウザでの操作確認は未実施。

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

## Node.js の選択と更新

このプロジェクトでは mise による実行を使う。シェルの自動切り替えが有効でない環境でも、`mise exec --` を付ければ指定版を選べる。

```bash
mise install
mise exec -- node --version
mise exec -- npm test
mise exec -- npm run lint
mise exec -- npm run build
```

`start.command` は mise が見つかる場合、指定版を適用して起動する。Windows のダブルクリック起動は PATH 上の Node.js を使うため、指定版での起動には `mise exec -- npm run dev` を使う。

既に起動中のプロセスは自動で更新されない。古いプレイヤーを終了してから再起動する。

将来の修正時は、公式告知で修正版を確認し、`mise use --path mise.toml --pin node@<修正版>` で設定を更新して検証する。Homebrew 自体の更新は別途行う。
