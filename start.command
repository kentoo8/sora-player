#!/bin/bash
# このスクリプトがあるディレクトリに移動
cd "$(dirname "$0")"

echo "------------------------------------------"
echo "  Sora Player - Startup Script"
echo "------------------------------------------"

# ポート3000が既に使用されているか確認
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo "サーバーは既に起動しているようです。ブラウザを開きます..."
    open http://localhost:3000
    exit 0
fi

# Node.js がインストールされているか確認
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "エラー: Node.jsが見つかりません。"
    echo "https://nodejs.org/ からダウンロードしてインストールしてください。"
    echo ""
    read -p "Enterキーを押して終了します..."
    exit 1
fi

# 依存関係（node_modules）のチェックとインストール
if [ ! -d "node_modules" ]; then
    echo "初回準備を行っています（これには数分かかる場合があります）..."
    npm install
fi

echo "サーバーを起動しています..."
echo "起動後、自動でブラウザが開かない場合は http://localhost:3000 を開いてください。"
echo "------------------------------------------"

# ブラウザを自動で開く（2秒待機してバックグラウンドで実行）
(sleep 2 && open http://localhost:3000) &

npm run dev
