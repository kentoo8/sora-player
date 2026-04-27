<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->


# 運用ルール
- 機能の変更をした際は、必ず`README.md`をチェックし、同期すること。
- `git add` によるステージングや `git commit` をAIが自動で行うことは禁止。
- 変更作業が完了した際は、AIは毎回必ず実行用コマンド（`git add` および適切なメッセージを含めた `git commit -m "..."`）をチャット上に提示し、ユーザーが手動で実行する運用とする。
- `git push` はどのような場合であっても絶対に行わないこと。


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
