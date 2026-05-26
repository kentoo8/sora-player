import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMissingSourceVideosError,
  buildMissingThumbnailsError,
} from '../scripts/export-gallery.mjs';

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
  assert.match(message, /start\.command/);
  assert.match(message, /npm run dev/);
  assert.match(message, /http:\/\/localhost:3000/);
  assert.match(message, /減らなくなったら/);
  assert.match(message, /search: gen_01ka19fcz4e1cr9pnwgx5hsejm/);
  assert.match(message, /上記 ID を検索バーに1件ずつ貼り付け/);
  assert.match(message, /全体放置だけでは止まることがあります/);
  assert.match(message, /公開候補タグを外す/);
  assert.match(message, /meta:no-public/);
  assert.match(message, /npm run generate:manifest -- --duplicate-strategy prefer-oldest/);
});
