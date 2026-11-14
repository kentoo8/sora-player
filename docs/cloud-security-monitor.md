# Macを閉じている間のセキュリティ確認

GitHub Actionsの「Sora security monitor」が、GitHub上のmainを毎日07:00（日本時間）に確認する。Macの起動は不要。Node.jsはmise.tomlの指定版で実行し、ロックファイルのnpm監査を実行用・開発用に分ける。パッケージのインストールは不要。

Node.js本体はnpm監査の対象外。公式配布一覧のsecurity指定から、同一メジャー内の新しい修正版を探し、公式サポート期限も確認する。修正版の公開前予告や、公開サイトでの悪用可否の判断はこの処理の対象に含めない。必要な判断・更新準備は既存のローカル監視と手動確認を併用する。

## 初回に行う設定

1. この変更をmainへpushする。
2. リポジトリのSettingsを開き、左側のSecurity and quality内のAdvanced SecurityでDependency graphとDependabot alertsを有効にする。Dependabot secretsは認証情報の登録画面なので、この設定では使用しない。Dependabotは新しい依存関係の脆弱性を継続して検知する。利用できる設定は管理画面で確認する。
3. リポジトリのWatchでCustomのIssuesとSecurity alertsを購読する。
4. GitHubの[通知設定](https://github.com/settings/notifications)で、WatchingのEmailを有効にする。検証済みの通知先メールを選び、Security alertsのメールとActionsの失敗通知も有効にする。
5. Actionsタブで「Sora security monitor」を開く。Run workflowの「受信確認用のテストIssueを作る」を選び実行する。テストIssue、メール、必要ならGitHubアプリの通知を確認し、受信確認後にテストIssueを閉じる。
6. テスト項目を選ばず通常実行する。実行履歴が成功し、検出があれば監視Issueが作られることを確認する。

Actionsを利用禁止にしている場合やIssue作成権限の制限がある場合は、実行結果に従って設定を確認する。外部の送信サービスや個人用トークンの登録は不要。GitHubが登録済みの通知先へ送信する。Issueの作成成功とメール受信は別に確認する。

## 通知の読み方

新しい問題、対象版・重大度・修正案の変化、解消、確認失敗があると「【Sora監視】セキュリティ確認」のIssueへ記録する。同じ結果の日はコメントを追加しない。Issue本文には最新の状態を表示し、変化はコメントでも通知する。初回に既知の問題が通知されるのは、この監視の基準を作るため。

「実行用依存」「開発用依存」「用途の区分未確認」を区別する。同じアドバイザリが依存元へ波及しても別問題として数えない。npmの修正案の有無は手がかりであり、修正版と互換性を根拠リンクから確認する。

確認失敗を含む結果もIssueに残す。結果収集やNode.js準備の失敗は、可能なら通知ステップが引き継ぐ。GitHub APIやIssue通知自体が失敗した場合はActionsが失敗するため、Actionsの失敗メールも有効にする。公開リポジトリのIssueは公開される。本文はパッケージ名・版・公式リンク・固定のエラー識別子に限定し、生ログや環境変数、秘密、ローカルデータを載せない。

通知テストは実際の監視状態を変えず、独立したテストIssueを作る。繰り返すとテストIssueも増えるため、受信確認が必要なときにだけ実行する。

## 実行が途絶えた場合

GitHubの定期実行には遅延や実行漏れがある。公開リポジトリは60日間活動がないと定期実行が無効になることもある。少なくとも月に一度Actionsの最終実行を確認し、停止していれば再有効化してRun workflowで確認する。処理自身では、処理が一度も起動しない状態の通知はできない。自動の死活通知が必要なら、別サービスから最終実行を監視する仕組みを追加する必要がある。

標準LinuxのGitHub-hosted runnerを使用する。利用枠・課金条件・組織の制限はGitHubの設定で確認する。

既存のMac側タスクは、クラウドでの通常実行とメール到達を確認してから役割を整理する。GitHub側は検知とIssue通知を担当し、更新・デプロイ・緊急停止の判断は既存の運用方針を参照する。

## 実装変更時の確認

```bash
mise exec -- node --test .github/scripts/security-monitor.test.mjs
```

ローカルで検知処理だけを試す場合は、MONITOR_REPORTに一時ファイルの出力先を指定して`.github/scripts/security-monitor.mjs --collect`を実行する。通知テストはActionsから実行し、実際の受信も確認する。

## 公式資料

- [GitHubの定期実行と停止条件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHubの通知設定](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications)
- [Dependabot alerts](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-alerts)
- [Node.js公式配布一覧](https://nodejs.org/dist/index.json)
- [Node.jsサポート期間](https://github.com/nodejs/Release#release-schedule)
