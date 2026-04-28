# Hio1345 Sora Player

Sora2のエクスポート動画ファイルをローカルでプレビュー・管理するためのビューア。

## 準備
1. **Node.js**: [公式サイト](https://nodejs.org/)から「推奨版 (LTS)」をダウンロードしてインストールしてください。

2. **動画の配置**: `videos/` フォルダに、Sora からエクスポートした動画データを以下の構成で配置してください。

   ```text
   videos/
     ├── User_A/                (1) アカウント名でフォルダを作成
     │   ├── sora-data-files-export-1/  (2) Sora からのエクスポートフォルダ
     │   ├── sora-data-files-export-2/
     │   └── ...
     ├── User_B/                (3) 複数アカウントがある場合は同様に作成
     │   └── sora-data-files-export-1/
     └── ...
   ```

## 起動

### 最も簡単な方法
1. 各OSに合わせて以下のファイルをダブルクリックします。
   - **Mac**: `start.command`
   - **Windows**: `start.bat`
2. 自動的にブラウザが開き、プレイヤーが表示されます。
   （開かない場合はブラウザで `http://localhost:3000` を開いてください）

### コマンドラインでの起動
1. 依存関係のインストールと起動
   ```bash
   npm install
   npm run dev
   ```
2. 別のターミナルでブラウザを開く
   ```bash
   npm run open
   ```

## 基本操作
- **↑ / ↓ / スワイプ**: 動画の切り替え
- **Space**: 再生 / 一時停止
