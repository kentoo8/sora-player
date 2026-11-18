# セキュリティ保守

Macを閉じている間の検知とメール通知は[GitHub上の監視手順](cloud-security-monitor.md)を参照する。

## 2026-11-18 の依存関係調査

- Next.js と eslint-config-next を最新安定版 16.4.6 に更新した。[キャッシュの情報漏えい](https://github.com/advisories/GHSA-mfr8-8qww-v76h)は 16.4.5 で修正済み。更新前のソースにも `use cache` と `unstable_cache()` の併用、root params の利用はなく、成立条件には該当しなかった。
- TypeScript ESLint を 8.73.0 に更新し、依存元の正式な指定 `minimatch: ^11.0.1` に従って 11.0.9 を導入した。[minimatch の問題](https://github.com/advisories/GHSA-g3hv-75wg-m249)は 11.0.1 で修正済み。旧版の待機判断は不要になったため削除した。3.1.5 も別経路で残るが、この問題の影響範囲（7以上11.0.1未満）には含まれない。
- Node.js は公式配布一覧で最新安定版が 26.13.1 であることを確認し、指定を維持した。27系はプレリリース。

再監査では、開発用の [picomatch の ReDoS](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) が残る。公式情報では 4.0.7 以下が対象で修正版はなく、npm の最新版も 4.0.7。導入されている 2.3.2 と 4.0.7 は対象で、依存元への波及込みで High 14件と表示されるが、アドバイザリは1件。

経路は eslint-config-next → Next.js ESLint plugin → fast-glob → micromatch、および TypeScript ESLint / TypeScript import resolver → tinyglobby → picomatch（fdir経由を含む）。悪用には攻撃者が細工した glob パターンを処理させる必要がある。確認した呼び出しは開発用のプロジェクト設定や tsconfig のパターンを扱い、動画検索やHTTPリクエストを直接渡す経路は確認されなかった。信頼できない設定を取り込んで lint を実行する場合は注意が必要。修正版の公開時に再調査し、監査結果から除外しない。npm の更新案である eslint-config-next 14系へのダウングレードは採用しない。

追加調査では、実効 ESLint 設定に Next.js の `rootDir` と TypeScript ESLint の `project` の glob 指定がなく、import resolver が読む tsconfig の include/exclude にも問題となる繰り返し extglob がないことを確認した。現在の設定を信頼して使う範囲では修正版を待ってよいと判断し、`.github/security-assessments.json` に条件を保存した。監視は脆弱性を検出し続け、ソース・設定・依存関係、公式の悪用条件や修正情報、依存元6パッケージの公開版・依存指定の変化で待機判断を解除する。信頼できない設定を取り込む場合には、実行前にパターンを確認する。

監視の再試行・診断ログ追加後に待機判断が失効したため、変更差分・実効ESLint設定・tsconfig・依存経路を再確認した。アプリや設定への変更はなく、公式アドバイザリと依存元6パッケージの公開状況も保存時と一致した。picomatchの最新版は引き続き4.0.7で修正版はない。既存の待機判断が成立することを再確認し、根拠と対象ソースの条件を更新した。

プレイヤーはローカル利用向けだが、`server.js` は待受ホストを限定していない。実際の外部公開・ファイアウォールの設定は未確認であり、ローカル専用の待受と断定しない。公開ギャラリーへのデプロイは別プロジェクトで、この更新の対象外。

README の起動・更新案内は確認済みで、操作の変更はない。

Node.js 26.13.1 で `npm ci --ignore-scripts`、テスト26件、監視テスト12件、lint、型チェック、`npm run build -- --webpack` が成功した。実行用監査は0件。インストール時には既存の ESLint 10 と一部プラグインの peer dependency 警告が出るが、lint は成功した。標準の Turbopack ビルドは実行環境のポート利用制限により失敗しており、成功未確認。ブラウザ上の一覧・検索・再生・音声・タグ編集は利用者による確認が必要。

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
