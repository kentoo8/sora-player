# セキュリティ保守

Macを閉じている間の検知とメール通知は[GitHub上の監視手順](cloud-security-monitor.md)を参照する。

## 更新後の確認

依存関係の再現にはロックファイルを使う。`npm ci` は既存の node_modules を入れ替える。

```bash
mise exec -- npm ci --ignore-scripts
mise exec -- npm audit
mise exec -- npm audit --omit=dev
mise exec -- npm test
mise exec -- npm run lint
mise exec -- npx --no-install tsc --noEmit
mise exec -- npm run build
```

`npm audit` は開発用依存も含み、`--omit=dev` は実行用依存を確認する。同じ問題が依存元にも計上されるため、件数だけで影響を判断しない。Node.js 本体は npm の監査対象外なので、公式のセキュリティ告知も確認する。

修正を進める場合は、公式の修正版と依存元の対応を確認する。上流の対応待ちなら未解決と報告し、`npm audit fix --force` や互換性未確認の override で件数を消さない。インストール時の peer dependency 警告は、公式の対応情報と lint の実行結果を照合する。警告と実行失敗を区別し、必要な検証に失敗したまま反映しない。

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
