#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  buildExport,
  buildMissingSourceVideosError,
  countExcludedTags,
  formatTagCounts,
  readManifest,
  readSourceVideos,
  readTags,
  resolveSourceManifest,
  resolveVideosDir,
} from './export-gallery.mjs';
import {
  parseArgs as parsePrepareArgs,
} from './prepare-gallery-upload.mjs';
import {
  refreshVideoManifest,
} from '../src/lib/video-library.mjs';
import { createProgressReporter } from '../src/lib/progress.mjs';

function printUsage() {
  console.log(`Usage:
  npm run generate:gallery-thumbnails -- --config data/gallery-export-config.json

Options:
  --config <path>               Export config path. Default: data/gallery-export-config.json if it exists.
  --include-tag <tag>           Only videos with this local tag are targeted. Can be repeated.
  --exclude-tag <tag>           Videos with this local tag are excluded. Can be repeated.
  --manifest <path>             Public ID manifest path. Default: data/gallery-export-manifest.json
  --source-manifest <path>      Video manifest path. Default: config manifestPath or <videosDir>/_metadata/manifest.json
  --tags <path>                 Local tags file path. Default: data/tags.json
  --videos-dir <path>           Source videos directory. Default: config.json videosDir, VIDEOS_DIR, or ./videos
  --private-tags <a,b>          Tags removed from public output. Default: public,private,internal
  --private-tag-prefix <prefix> Tags with this prefix are removed from public output. Default: meta:
  --allowed-meta-tag <tag>      Allowed meta tag. Unknown meta:* tags on candidates fail generation.
  --public-base-url <url>       Public base URL used for consistency checks. Default: https://example.com
  --seek <seconds>              Capture position in seconds. Default: 0.1
  --help                        Show this help.
`);
}

function parseArgs(argv) {
  const options = parsePrepareArgs(argv, { allowUnknown: true });
  options.seek = 0.1;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--seek') {
      options.seek = Number(requireValue(arg, next));
      index += 1;
    }
  }
  return options;
}

function requireValue(option, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function validateOptions(options) {
  if (options.help) return;
  if (options.includeTags.length === 0) throw new Error('--include-tag is required to avoid accidental full export');
  if (!/^https:\/\//.test(options.publicBaseUrl)) throw new Error('--public-base-url must start with https://');
  if (!Number.isFinite(options.seek) || options.seek < 0) throw new Error('--seek must be a non-negative number');
}

function findSourceByLocalKey(sourceVideos, localKey) {
  return sourceVideos.find((video) => video.localKey === localKey);
}

function ffmpegMissing(result) {
  return result.error && result.error.code === 'ENOENT';
}

function commandExists(command) {
  const result = spawnSync('which', [command], {
    encoding: 'utf8',
  });
  return result.status === 0;
}

function encodeWebpWithCwebp(inputPath, outputPath, tempDir) {
  if (!commandExists('cwebp')) {
    return { ok: false, reason: 'WEBP_ENCODER_NOT_FOUND' };
  }
  const tempOutputPath = path.join(tempDir, `${path.basename(outputPath, '.webp')}.webp`);
  const result = spawnSync('cwebp', [
    '-quiet',
    '-q',
    '82',
    inputPath,
    '-o',
    tempOutputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !fs.existsSync(tempOutputPath)) {
    return {
      ok: false,
      reason: result.stderr?.trim() ? `WEBP_ENCODE_FAILED: ${result.stderr.trim().split('\n')[0]}` : 'WEBP_ENCODE_FAILED',
    };
  }
  fs.renameSync(tempOutputPath, outputPath);
  return { ok: true };
}

function capturePngFrame({ source, outputPath, seek }) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(seek),
    '-i',
    source.fullPath,
    '-frames:v',
    '1',
    '-an',
    '-vf',
    'scale=640:-1',
    outputPath,
  ], { encoding: 'utf8' });

  if (ffmpegMissing(result)) {
    return { ok: false, reason: 'FFMPEG_NOT_FOUND' };
  }
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    return {
      ok: false,
      reason: result.stderr?.trim() ? `VIDEO_DECODE_FAILED: ${result.stderr.trim().split('\n')[0]}` : 'VIDEO_DECODE_FAILED',
    };
  }
  return { ok: true };
}

function generateWebpThumbnailViaPng({ source, outputPath, seek }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-player-thumbnail-'));
  const pngPath = path.join(tempDir, `${source.localKey}.png`);
  try {
    const capture = capturePngFrame({ source, outputPath: pngPath, seek });
    if (!capture.ok) return { status: 'failed', reason: capture.reason };
    const encode = encodeWebpWithCwebp(pngPath, outputPath, tempDir);
    if (!encode.ok) return { status: 'failed', reason: encode.reason };
    return { status: 'generated' };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function generateWebpThumbnail({ source, outputPath, seek }) {
  if (fs.existsSync(outputPath)) return { status: 'existing' };
  if (!fs.existsSync(source.fullPath)) {
    return { status: 'failed', reason: 'SOURCE_FILE_NOT_FOUND' };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(seek),
    '-i',
    source.fullPath,
    '-frames:v',
    '1',
    '-an',
    '-vf',
    'scale=640:-1',
    '-c:v',
    'libwebp',
    '-quality',
    '82',
    outputPath,
  ], { encoding: 'utf8' });

  if (ffmpegMissing(result)) {
    return { status: 'failed', reason: 'FFMPEG_NOT_FOUND' };
  }
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    if (result.stderr?.includes("Unknown encoder 'libwebp'")) {
      return generateWebpThumbnailViaPng({ source, outputPath, seek });
    }
    return {
      status: 'failed',
      reason: result.stderr?.trim() ? `VIDEO_DECODE_FAILED: ${result.stderr.trim().split('\n')[0]}` : 'VIDEO_DECODE_FAILED',
    };
  }
  return { status: 'generated' };
}

export function generateMissingGalleryThumbnails({ sourceVideos, missingThumbnails, videosDir, seek = 0.1, onProgress }) {
  const failed = [];
  let generated = 0;
  let existing = 0;
  const thumbnailsDir = path.join(videosDir, '_thumbnails');

  for (const [index, item] of missingThumbnails.entries()) {
    const source = findSourceByLocalKey(sourceVideos, item.id);
    const outputPath = path.join(thumbnailsDir, `${item.id}.webp`);
    if (!source) {
      failed.push({ id: item.id, reason: 'SOURCE_NOT_FOUND_IN_MANIFEST' });
      onProgress?.({ current: index + 1, total: missingThumbnails.length, id: item.id });
      continue;
    }

    const result = generateWebpThumbnail({ source, outputPath, seek });
    if (result.status === 'generated') {
      generated += 1;
    } else if (result.status === 'existing') {
      existing += 1;
    } else {
      failed.push({ id: item.id, reason: result.reason });
    }
    onProgress?.({ current: index + 1, total: missingThumbnails.length, id: item.id });
  }

  return { generated, existing, failed, outputDir: thumbnailsDir };
}

export function loadGalleryThumbnailContext(options) {
  const videosDir = resolveVideosDir(options.videosDir);
  if (!fs.existsSync(videosDir)) {
    throw new Error(`Videos directory does not exist: ${videosDir}`);
  }

  const sourceManifest = resolveSourceManifest(options);
  refreshVideoManifest({ videosDir, manifestPath: sourceManifest });
  const sourceVideos = readSourceVideos({ videosDir, sourceManifest });
  const tagsByFilename = readTags(options.tags);
  const manifest = readManifest(options.manifest);
  const exportResult = buildExport({ sourceVideos, tagsByFilename, manifest, options });
  return { videosDir, sourceManifest, sourceVideos, exportResult };
}

export function runGalleryThumbnailGeneration(options) {
  validateOptions(options);
  const { videosDir, sourceManifest, sourceVideos, exportResult } = loadGalleryThumbnailContext(options);

  if (exportResult.missingSourceVideos.length > 0) {
    throw new Error(buildMissingSourceVideosError(exportResult.missingSourceVideos, {
      tagsPath: options.tags,
      sourceManifest,
      videosDir,
    }));
  }

  const result = generateMissingGalleryThumbnails({
    sourceVideos,
    missingThumbnails: exportResult.missingThumbnails,
    videosDir,
    seek: options.seek,
    onProgress: createProgressReporter('Generating thumbnails'),
  });
  refreshVideoManifest({ videosDir, manifestPath: sourceManifest });
  return { ...result, videosDir, sourceManifest, exportResult };
}

export function printGalleryThumbnailSummary(result) {
  const publicCandidates = result.exportResult.exported.length + result.exportResult.missingThumbnails.length;
  const existingThumbnails = result.exportResult.exported.length + result.existing;
  console.log('Gallery thumbnail generation');
  console.log(`Candidates: ${publicCandidates}`);
  console.log(`Existing thumbnails: ${existingThumbnails}`);
  console.log(`Generated: ${result.generated}`);
  console.log(`Failed: ${result.failed.length}`);
  console.log(`Output: ${result.outputDir}`);
  console.log(`Video manifest: ${result.sourceManifest}`);
  if (result.exportResult.orphanTagEntries.length > 0) {
    console.log(`manifest に存在しないタグ項目: ${result.exportResult.orphanTagEntries.length}`);
  }
  if (result.exportResult.excluded.length > 0) {
    console.log(`Excluded tags: ${formatTagCounts(countExcludedTags(result.exportResult.excluded))}`);
  }
  if (result.failed.length > 0) {
    for (const item of result.failed) {
      console.log(`- ${item.id} reason=${item.reason}`);
    }
  }
  if (result.failed.length === 0) {
    console.log('Generate gallery thumbnails succeeded!');
  }
}

export function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const result = runGalleryThumbnailGeneration(options);
  printGalleryThumbnailSummary(result);
  if (result.failed.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
