@echo off
setlocal
:: このスクリプトがあるディレクトリに移動
cd /d %~dp0

echo ------------------------------------------
echo   Sora Player - Startup Script (Windows)
echo ------------------------------------------

:: Node.js がインストールされているか確認
where node >nul 2>nul && where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo エラー: Node.jsが見つかりません。
    echo https://nodejs.org/ からダウンロードしてインストールしてください。
    echo.
    pause
    exit /b 1
)

:: 依存関係（node_modules）のチェックとインストール
if not exist "node_modules\" (
    echo 初回準備を行っています（これには数分かかる場合があります）...
    npm install
)

echo "サーバーを起動しています..."
echo "起動後、自動でブラウザが開かない場合は http://localhost:3000 を開いてください。"
echo "------------------------------------------"

:: ブラウザを自動で開く
start http://localhost:3000

npm run dev

:: エラーで止まった場合にウィンドウを閉じないようにする
if %errorlevel% neq 0 (
    pause
)
