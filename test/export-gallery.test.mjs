import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildMissingSourceVideosError,
  buildMissingThumbnailsError,
} from '../scripts/export-gallery.mjs';
import {
  generateMissingGalleryThumbnails,
} from '../scripts/generate-gallery-thumbnails.mjs';

test('buildMissingSourceVideosError explains actionable recovery steps', () => {
  const message = buildMissingSourceVideosError(
    [
      {
        id: 'gen_01kgq2vtv2egrbt224efx43h82',
        tags: ['黒髪ダウナーと金髪ゴスロリ'],
      },
    ],
    {
      tagsPath: 'data/tags.json',
      sourceManifest: '/videos/_metadata/manifest.json',
      videosDir: '/videos',
    },
  );

  assert.match(message, /公開候補タグが付いているのに/);
  assert.match(message, /gen_01kgq2vtv2egrbt224efx43h82 tags=黒髪ダウナーと金髪ゴスロリ/);
  assert.match(message, /data\/tags\.json にタグだけ残っていて/);
  assert.match(message, /動画ファイルを動画フォルダへ戻して/);
  assert.match(message, /data\/tags\.json から上記 ID のタグ項目を削除/);
  assert.match(message, /meta:no-public/);
});

test('buildMissingThumbnailsError explains how to generate or exclude thumbnails', () => {
  const message = buildMissingThumbnailsError(
    [
      {
        id: 'gen_01ka19fcz4e1cr9pnwgx5hsejm',
      },
    ],
    {
      sourceManifest: '/videos/_metadata/manifest.json',
      videosDir: '/videos',
    },
  );

  assert.match(message, /公開候補のサムネイルが未生成です/);
  assert.match(message, /gen_01ka19fcz4e1cr9pnwgx5hsejm/);
  assert.match(message, /thumbnailUrl が必須/);
  assert.match(message, /npm run generate:gallery-thumbnails -- --config data\/gallery-export-config\.json/);
  assert.match(message, /npm run generate:manifest/);
  assert.match(message, /同じ gallery export \/ upload \/ sync コマンドを再実行/);
  assert.match(message, /http:\/\/localhost:3000/);
  assert.match(message, /videoPath=/);
  assert.match(message, /公開候補タグを外す/);
  assert.match(message, /meta:no-public/);
  assert.match(message, /--fix-thumbnails/);
});

test('generateMissingGalleryThumbnails does not overwrite existing thumbnails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-player-thumbnails-'));
  const thumbnailDir = path.join(dir, '_thumbnails');
  const id = 'gen_01ka19fcz4e1cr9pnwgx5hsejm';
  const thumbnailPath = path.join(thumbnailDir, `${id}.webp`);
  fs.mkdirSync(thumbnailDir, { recursive: true });
  fs.writeFileSync(thumbnailPath, 'existing');

  const result = generateMissingGalleryThumbnails({
    videosDir: dir,
    sourceVideos: [{ localKey: id, fullPath: path.join(dir, `${id}.mp4`) }],
    missingThumbnails: [{ id }],
  });

  assert.equal(result.existing, 1);
  assert.equal(result.generated, 0);
  assert.deepEqual(result.failed, []);
  assert.equal(fs.readFileSync(thumbnailPath, 'utf8'), 'existing');
});
