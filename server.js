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

  const videosDir = process.env.VIDEOS_DIR;
  if (!videosDir) {
    console.error('Error: VIDEOS_DIR environment variable is not set.');
    process.exit(1);
  }

  // 外部ディレクトリの動画ファイルを静的配信
  server.use('/videos', express.static(videosDir, {
    acceptRanges: true, // Rangeリクエストをサポート（動画再生に必須）
  }));

  // それ以外のリクエストはNext.jsに任せる
  server.all(/.*/, (req, res) => {
    return handle(req, res);
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
});
