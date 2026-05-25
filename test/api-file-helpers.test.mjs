import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getErrorMessage,
  isPathInsideDirectory,
  resolveArchivePathForVideosDir,
  resolveExistingVideosDir,
  resolveRuntimeLibraryOptions,
} from '../src/lib/api-file-helpers.mjs';

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sora-player-test-'));
}

test('isPathInsideDirectory accepts nested paths and rejects traversal outside the videos directory', () => {
  const root = createTempRoot();
  const videosDir = path.join(root, 'videos');
  const nestedFile = path.join(videosDir, 'account', 'gen_01.mp4');
  const siblingFile = path.join(root, 'outside.mp4');

  assert.equal(isPathInsideDirectory(nestedFile, videosDir), true);
  assert.equal(isPathInsideDirectory(videosDir, videosDir), true);
  assert.equal(isPathInsideDirectory(siblingFile, videosDir), false);
});

test('resolveExistingVideosDir falls back to ./videos when configured directory is missing', () => {
  const root = createTempRoot();
  const fallbackVideosDir = path.join(root, 'videos');
  fs.mkdirSync(fallbackVideosDir, { recursive: true });

  assert.equal(
    resolveExistingVideosDir(path.join(root, 'missing-videos'), root),
    fallbackVideosDir,
  );
});

test('resolveRuntimeLibraryOptions rewrites default archive paths when using fallback videos directory', () => {
  const root = createTempRoot();
  const configuredVideosDir = path.join(root, 'missing-videos');
  const fallbackVideosDir = path.join(root, 'videos');
  fs.mkdirSync(fallbackVideosDir, { recursive: true });

  const options = resolveRuntimeLibraryOptions({
    videosDir: configuredVideosDir,
    manifestPath: path.join(configuredVideosDir, '_metadata', 'manifest.json'),
    reportPath: path.join(configuredVideosDir, '_reports', 'scan-report.json'),
    duplicateStrategy: 'manual',
  }, root);

  assert.deepEqual(options, {
    videosDir: fallbackVideosDir,
    manifestPath: path.join(fallbackVideosDir, '_metadata', 'manifest.json'),
    reportPath: path.join(fallbackVideosDir, '_reports', 'scan-report.json'),
    duplicateStrategy: 'manual',
  });
});

test('resolveArchivePathForVideosDir keeps custom archive paths outside the original videos directory', () => {
  const root = createTempRoot();
  const originalVideosDir = path.join(root, 'missing-videos');
  const fallbackVideosDir = path.join(root, 'videos');
  const customManifestPath = path.join(root, 'custom', 'manifest.json');

  assert.equal(
    resolveArchivePathForVideosDir(customManifestPath, originalVideosDir, fallbackVideosDir),
    customManifestPath,
  );
});

test('getErrorMessage handles Error instances and non-error throws', () => {
  assert.equal(getErrorMessage(new Error('failed')), 'failed');
  assert.equal(getErrorMessage('plain failure'), 'plain failure');
});
