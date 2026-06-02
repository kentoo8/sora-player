import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseArgs, readObjectKeys } from '../scripts/delete-gallery-objects.mjs';
import { defaultGalleryOutputDir } from '../src/lib/gallery-output.mjs';

test('parseArgs defaults to the gallery sync delete manifest', () => {
  assert.equal(parseArgs([]).manifest, path.join(defaultGalleryOutputDir('gallery-sync'), 'delete-manifest.json'));
});

test('readObjectKeys returns video and thumbnail object keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-player-delete-gallery-'));
  const manifestPath = path.join(dir, 'delete-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify([
    {
      videoObjectKey: 'videos/example.mp4',
      thumbnailObjectKey: 'thumbnails/example.webp',
    },
  ]));

  assert.deepEqual(readObjectKeys(manifestPath), [
    'videos/example.mp4',
    'thumbnails/example.webp',
  ]);
});
