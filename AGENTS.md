<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->


# 運用ルール
- 機能の変更をした際は、必ず`README.md`をチェックし、同期すること。
- AI は変更作業が完了したら、確認を待たずに `git add` と `git commit` まで実行してよい。
- 直後に訂正があった場合は、必要に応じて `git commit --amend` で対応してよい。
- `git push` はどのような場合であっても絶対に行わないこと。
- ブラウザ上の操作確認は原則ユーザーが担当する。AIは実装、静的確認、`npm run build` などのコマンド確認を担当し、必要な確認手順をチャット上に提示する。

## Codex sandbox からの実行

- `~/src/sora-gallery` から作業している Codex セッションでは、この `sora-player` リポジトリは writable root 外になることがある。
- `data/gallery-export-manifest.json` の生成・更新など、`sora-player` 側にファイルを書き込むコマンドは、最初から権限付きで実行する。
- 例: `npm run prepare:gallery-upload` で manifest を作る場合、通常実行で失敗させてから再実行しない。
- 読み取り、`git status`、差分確認などは通常実行でよい。


# コミットメッセージのフォーマット

prefix + 日本語で記載すること。

## prefixの例

- feat: 新機能
- fix: バグ修正
- docs: ドキュメント修正
- style: コードの整形（インデント、セミコロンなど、実行に影響しない修正。CSSやデザインの変更は feat を使用すること）
- refactor: リファクタリング
- perf: パフォーマンス改善
- test: テスト関連
- chore: ビルド、補助ツール、ライブラリ関連
