import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  addTagsToVideos,
  getTagsPaths,
  normalizeTagUpdates,
  normalizeTags,
  normalizeTagsFile,
  readTagsFile,
  replaceTagsForVideos,
  writeTagsFile,
} from '../src/lib/tag-library.mjs';

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sora-player-tags-test-'));
}

test('normalizeTags trims, deduplicates, sorts, and drops invalid values', () => {
  assert.deepEqual(
    normalizeTags([' beta ', '', 'alpha', 'beta', null, 123, '公開']),
    ['alpha', 'beta', '公開'],
  );
});

test('normalizeTagsFile removes empty filenames and empty tag entries', () => {
  assert.deepEqual(
    normalizeTagsFile({
      version: 999,
      videos: {
        '': ['ignored'],
        'gen_a': [' public ', 'public', ''],
        'gen_b': [],
        'gen_c': 'not-array',
      },
    }),
    {
      version: 1,
      videos: {
        gen_a: ['public'],
      },
    },
  );
});

test('addTagsToVideos merges tags without duplicating existing tags', () => {
  const tagsFile = { version: 1, videos: { gen_a: ['favorite'] } };

  assert.equal(addTagsToVideos(tagsFile, ['gen_a', 'gen_b'], [' public ', 'favorite']), true);
  assert.deepEqual(tagsFile.videos, {
    gen_a: ['favorite', 'public'],
    gen_b: ['favorite', 'public'],
  });
});

test('addTagsToVideos rejects empty filenames or empty tags', () => {
  const tagsFile = { version: 1, videos: {} };

  assert.equal(addTagsToVideos(tagsFile, [], ['public']), false);
  assert.equal(addTagsToVideos(tagsFile, ['gen_a'], ['']), false);
  assert.deepEqual(tagsFile.videos, {});
});

test('replaceTagsForVideos applies per-video updates and deletes empty tag sets', () => {
  const tagsFile = {
    version: 1,
    videos: {
      gen_a: ['old'],
      gen_b: ['old'],
      gen_c: ['keep'],
    },
  };

  assert.equal(
    replaceTagsForVideos(tagsFile, [], [], [
      { filename: 'gen_a', tags: ['new', ' public '] },
      { filename: 'gen_b', tags: [] },
      { filename: '', tags: ['ignored'] },
    ]),
    true,
  );

  assert.deepEqual(tagsFile.videos, {
    gen_a: ['new', 'public'],
    gen_c: ['keep'],
  });
});

test('replaceTagsForVideos overwrites shared filenames and deletes when tags are empty', () => {
  const tagsFile = {
    version: 1,
    videos: {
      gen_a: ['old'],
      gen_b: ['old'],
    },
  };

  assert.equal(replaceTagsForVideos(tagsFile, ['gen_a'], ['public'], []), true);
  assert.deepEqual(tagsFile.videos, {
    gen_a: ['public'],
    gen_b: ['old'],
  });

  assert.equal(replaceTagsForVideos(tagsFile, ['gen_b'], [], []), true);
  assert.deepEqual(tagsFile.videos, {
    gen_a: ['public'],
  });
});

test('normalizeTagUpdates drops invalid updates and normalizes valid tags', () => {
  assert.deepEqual(
    normalizeTagUpdates([
      { filename: 'gen_a', tags: [' b ', 'a'] },
      { filename: '', tags: ['ignored'] },
      { filename: 123, tags: ['ignored'] },
      null,
    ]),
    [{ filename: 'gen_a', tags: ['a', 'b'] }],
  );
});

test('readTagsFile and writeTagsFile round-trip normalized tag data', () => {
  const root = createTempRoot();
  const paths = getTagsPaths(root);
  const tagsFile = {
    version: 1,
    videos: {
      gen_a: [' public ', 'public'],
      gen_b: [],
    },
  };

  writeTagsFile(tagsFile, paths);

  assert.equal(fs.existsSync(paths.tagsPath), true);
  assert.deepEqual(readTagsFile(paths.tagsPath), {
    version: 1,
    videos: {
      gen_a: ['public'],
    },
  });
});
