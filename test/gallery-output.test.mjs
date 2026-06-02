import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultGalleryOutputDir,
  prepareGalleryOutputDir,
} from '../src/lib/gallery-output.mjs';

test('defaultGalleryOutputDir uses the OS temporary directory', () => {
  assert.equal(defaultGalleryOutputDir('gallery-sync'), path.join(os.tmpdir(), 'sora-player-gallery-sync'));
});

test('prepareGalleryOutputDir reuses a managed directory', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-player-gallery-output-'));
  const outDir = path.join(parent, 'sync');
  prepareGalleryOutputDir(outDir, 'gallery-sync');
  fs.writeFileSync(path.join(outDir, 'videos.json'), '[]');

  prepareGalleryOutputDir(outDir, 'gallery-sync');

  assert.equal(fs.existsSync(path.join(outDir, 'videos.json')), false);
  assert.equal(fs.existsSync(path.join(outDir, '.sora-player-gallery-output.json')), true);
});

test('prepareGalleryOutputDir refuses an unmanaged non-empty directory', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-player-gallery-output-'));
  const existingPath = path.join(outDir, 'keep.txt');
  fs.writeFileSync(existingPath, 'keep');

  assert.throws(
    () => prepareGalleryOutputDir(outDir, 'gallery-sync'),
    /not managed by sora-player gallery-sync/,
  );
  assert.equal(fs.readFileSync(existingPath, 'utf8'), 'keep');
});

test('prepareGalleryOutputDir refuses a marker for a different output type', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-player-gallery-output-'));
  const outDir = path.join(parent, 'output');
  prepareGalleryOutputDir(outDir, 'gallery-upload');

  assert.throws(
    () => prepareGalleryOutputDir(outDir, 'gallery-sync'),
    /not managed by sora-player gallery-sync/,
  );
});

test('prepareGalleryOutputDir refuses unsafe directories', () => {
  assert.throws(
    () => prepareGalleryOutputDir(path.parse(process.cwd()).root, 'gallery-sync'),
    /unsafe output directory/,
  );
  assert.throws(
    () => prepareGalleryOutputDir(process.cwd(), 'gallery-sync'),
    /unsafe output directory/,
  );
  assert.throws(
    () => prepareGalleryOutputDir(os.homedir(), 'gallery-sync'),
    /unsafe output directory/,
  );
});
