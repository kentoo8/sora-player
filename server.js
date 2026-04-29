const express = require('express');
const next = require('next');
const path = require('path');

const fs = require('fs');

// config.json の読み込み
let config = {};
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('> Loaded configuration from config.json');
  } catch (e) {
    console.error('> Error parsing config.json:', e.message);
  }
}

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = config.port || process.env.PORT || 3000;

app.prepare().then(() => {
  const server = express();

  let videosDir = config.videosDir || process.env.VIDEOS_DIR;
  const defaultDir = path.join(__dirname, 'videos');

  // 相対パスの場合は絶対パスに変換
  if (videosDir && !path.isAbsolute(videosDir)) {
    videosDir = path.resolve(__dirname, videosDir);
  }

  if (!videosDir) {
    if (fs.existsSync(defaultDir)) {
      videosDir = defaultDir;
      console.log(`> Using default video directory: ${videosDir}`);
    } else {
      console.warn('Warning: videosDir is not set in config.json and default "videos" folder not found.');
    }
  }

  // 外部ディレクトリの動画ファイルを静的配信（ディレクトリが存在する場合のみ）
  if (videosDir && require('fs').existsSync(videosDir)) {
    server.use('/videos', express.static(videosDir, {
      acceptRanges: true,
    }));
  }

  // それ以外のリクエストはNext.jsに任せる
  server.all(/.*/, (req, res) => {
    return handle(req, res);
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
});
