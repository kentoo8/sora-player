const express = require('express');
const next = require('next');
const path = require('path');

const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = process.env.PORT || 3000;

app.prepare().then(() => {
  const server = express();

  let videosDir = process.env.VIDEOS_DIR;
  const defaultDir = path.join(__dirname, 'videos');

  if (!videosDir) {
    if (require('fs').existsSync(defaultDir)) {
      videosDir = defaultDir;
      console.log(`> Using default video directory: ${videosDir}`);
    } else {
      console.warn('Warning: VIDEOS_DIR environment variable is not set and default "videos" folder not found.');
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
