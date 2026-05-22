#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  buildExport,
  readManifest,
  readTags,
  resolveVideosDir,
  scanVideos,
  writeJson,
} from './export-gallery.mjs';

function printUsage() {
  console.log(`Usage:
  npm run prepare:gallery-upload -- --include-tag public --out /private/tmp/sora-gallery-upload

Options:
  --include-tag <tag>           Required. Only videos with this local tag are prepared. Can be repeated.
  --out <path>                  Required. Upload staging directory.
  --manifest <path>             Public ID manifest path. Default: data/gallery-export-manifest.json
  --tags <path>                 Local tags file path. Default: data/tags.json
  --videos-dir <path>           Source videos directory. Default: config.json videosDir, VIDEOS_DIR, or ./videos
  --private-tags <a,b>          Tags removed from public output. Default: public,private,internal
  --public-base-url <url>       Public base URL used for consistency checks. Default: https://example.com
  --dry-run                     Print summary without copying files or writing manifest.
  --help                        Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    manifest: path.resolve(process.cwd(), 'data/gallery-export-manifest.json'),
    tags: path.resolve(process.cwd(), 'data/tags.json'),
    includeTags: [],
    privateTags: ['public', 'private', 'internal'],
    publicBaseUrl: 'https://example.com',
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--include-tag') {
      options.includeTags.push(requireValue(arg, next).trim());
      index += 1;
    } else if (arg === '--out') {
      options.out = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--manifest') {
      options.manifest = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--tags') {
      options.tags = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--videos-dir') {
      options.videosDir = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--private-tags') {
      options.privateTags = requireValue(arg, next).split(',').map((tag) => tag.trim()).filter(Boolean);
      index += 1;
    } else if (arg === '--public-base-url') {
      options.publicBaseUrl = requireValue(arg, next);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.includeTags = Array.from(new Set(options.includeTags)).filter(Boolean);
  options.privateTags = Array.from(new Set(options.privateTags)).filter(Boolean);
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
  if (!options.out) throw new Error('--out is required');
  if (options.includeTags.length === 0) throw new Error('--include-tag is required to avoid accidental full export');
  if (!/^https:\/\//.test(options.publicBaseUrl)) throw new Error('--public-base-url must start with https://');
}

function findSourceById(sourceVideos, manifest, publicId) {
  const entry = Object.entries(manifest.videos).find(([, value]) => value.id === publicId);
  if (!entry) return undefined;
  return sourceVideos.find((video) => video.localKey === entry[0]);
}

function assertWebpThumbnail(source) {
  if (!source.thumbnailPath) {
    throw new Error(`Missing thumbnail: ${source.localKey}`);
  }
  if (path.extname(source.thumbnailPath).toLowerCase() !== '.webp') {
    throw new Error(`Thumbnail must be webp for current gallery URLs: ${source.localKey}`);
  }
}

function copyPreparedFiles({ exported, sourceVideos, manifest, outDir }) {
  const videosOutDir = path.join(outDir, 'videos');
  const thumbnailsOutDir = path.join(outDir, 'thumbnails');
  assertEmptyDirectory(videosOutDir);
  assertEmptyDirectory(thumbnailsOutDir);
  fs.mkdirSync(videosOutDir, { recursive: true });
  fs.mkdirSync(thumbnailsOutDir, { recursive: true });

  const copied = [];
  for (const video of exported) {
    const source = findSourceById(sourceVideos, manifest, video.id);
    if (!source) {
      throw new Error(`Missing source for exported video: ${video.id}`);
    }
    assertWebpThumbnail(source);

    const manifestEntry = manifest.videos[source.localKey];
    const videoOutPath = path.join(outDir, manifestEntry.videoObjectKey);
    const thumbnailOutPath = path.join(outDir, manifestEntry.thumbnailObjectKey);
    fs.mkdirSync(path.dirname(videoOutPath), { recursive: true });
    fs.mkdirSync(path.dirname(thumbnailOutPath), { recursive: true });
    fs.copyFileSync(source.fullPath, videoOutPath);
    fs.copyFileSync(source.thumbnailPath, thumbnailOutPath);
    copied.push({
      id: video.id,
      video: videoOutPath,
      thumbnail: thumbnailOutPath,
    });
  }
  return copied;
}

function assertEmptyDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath);
  if (entries.length > 0) {
    throw new Error(`Output directory must be empty: ${dirPath}`);
  }
}

export function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  validateOptions(options);

  const videosDir = resolveVideosDir(options.videosDir);
  if (!fs.existsSync(videosDir)) {
    throw new Error(`Videos directory does not exist: ${videosDir}`);
  }

  const sourceVideos = scanVideos(videosDir);
  const tagsByFilename = readTags(options.tags);
  const manifest = readManifest(options.manifest);
  const { exported, missingThumbnails } = buildExport({ sourceVideos, tagsByFilename, manifest, options });

  if (missingThumbnails.length > 0) {
    throw new Error(`Cannot prepare upload because ${missingThumbnails.length} thumbnail(s) are missing`);
  }

  const copied = options.dryRun ? [] : copyPreparedFiles({ exported, sourceVideos, manifest, outDir: options.out });
  if (!options.dryRun) {
    writeJson(options.manifest, manifest);
    writeJson(path.join(options.out, 'videos.json'), exported);
    writeJson(path.join(options.out, 'upload-manifest.json'), copied);
  }

  console.log(`Scanned: ${sourceVideos.length}`);
  console.log(`Prepared: ${exported.length}`);
  console.log(`Output: ${options.out}`);
  console.log(`Manifest: ${options.manifest}`);
  if (options.dryRun) {
    console.log('Dry run: no files copied');
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
