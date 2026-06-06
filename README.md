# Hio1345 Sora Player

<img src="assets/preview.webp" width="450" />

Sora2 のエクスポート動画を、ローカルでまとめて見るためのプレイヤーです。

動画の一覧表示、検索、タグ付け、キーボード操作に対応しています。

## 準備

1. このリポジトリをダウンロードします（「Code」ボタン→「Download ZIP」）。
2. [Node.js LTS](https://nodejs.org/) をインストールします。
3. `videos/` の下に、Sora2 からエクスポートした動画フォルダを置きます。

```text
videos/
  your-account/
    sora-data-files-export-1/
    sora-data-files-export-2/
```

動画フォルダを別の場所に置きたい場合だけ、`config.json.example` を `config.json` にコピーして `videosDir` を変更してください。

## 起動

### ダブルクリック

- Mac: `start.command`
- Windows: `start.bat`

ブラウザが開かない場合は、手動で `http://localhost:3000` を開いてください。

### コマンドライン

```bash
npm install
npm run dev
```

別のターミナルで開く場合:

```bash
npm run open
```

終了するときは、起動しているターミナルを閉じます。

## 基本操作

- `↑` / `↓`: 前後の動画へ移動
- `←` / `→`: 閲覧履歴を戻る / 進む
- `/`: 一覧と検索を開く
- `Space`: 再生 / 一時停止
- `M`: ミュート切り替え
- `F`: フルスクリーン切り替え
- `R`: ランダム再生
- `?`: ショートカット一覧

タグ付けなどの細かい操作は、アプリ内のショートカット一覧を確認してください。

## うまくいかない時

一度ターミナルやコマンドプロンプトをすべて閉じてから、もう一度起動してください。

## 関連ドキュメント
公開用ギャラリーの運用手順は [docs/gallery-publish.md](docs/gallery-publish.md) にあります。

## 補足
@hio1345は作者のSora2アカウント名でした

## ライセンス

[MIT License](LICENSE)
