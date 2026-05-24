#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  applyConfig,
  buildExport,
  countExcludedTags,
  formatTagCounts,
  normalizeTag,
  normalizeTagPrefix,
  readManifest,
  readSourceVideos,
  readTags,
  resolveVideosDir,
  resolveSourceManifest,
  writeJson,
} from './export-gallery.mjs';

function printUsage() {
  console.log(`Usage:
  npm run prepare:gallery-upload -- --include-tag public --out /private/tmp/sora-gallery-upload

Options:
  --config <path>               Export config path. Default: data/gallery-export-config.json if it exists.
  --include-tag <tag>           Required. Only videos with this local tag are prepared. Can be repeated.
  --exclude-tag <tag>           Videos with this local tag are excluded. Can be repeated.
  --out <path>                  Required. Upload staging directory.
  --manifest <path>             Public ID manifest path. Default: data/gallery-export-manifest.json
  --source-manifest <path>      Video manifest path. Default: config manifestPath or <videosDir>/_metadata/manifest.json
  --tags <path>                 Local tags file path. Default: data/tags.json
  --videos-dir <path>           Source videos directory. Default: config.json videosDir, VIDEOS_DIR, or ./videos
  --private-tags <a,b>          Tags removed from public output. Default: public,private,internal
  --private-tag-prefix <prefix> Tags with this prefix are removed from public output. Default: meta:
  --allowed-meta-tag <tag>      Allowed meta tag. Unknown meta:* tags on candidates fail prepare.
  --public-base-url <url>       Public base URL used for consistency checks. Default: https://example.com
  --dry-run                     Print summary without copying files or writing manifest.
  --help                        Show this help.
`);
}

export function parseArgs(argv, extraOptions = {}) {
  const defaultConfig = path.resolve(process.cwd(), 'data/gallery-export-config.json');
  const options = {
    config: fs.existsSync(defaultConfig) ? defaultConfig : '',
    manifest: path.resolve(process.cwd(), 'data/gallery-export-manifest.json'),
    tags: path.resolve(process.cwd(), 'data/tags.json'),
    includeTags: [],
    excludeTags: [],
    privateTags: ['public', 'private', 'internal'],
    privateTagPrefixes: ['meta:'],
    allowedMetaTags: ['meta:public', 'meta:no-public'],
    publicBaseUrl: 'https://example.com',
    dryRun: false,
  };
  const cliSpecified = {
    publicBaseUrl: false,
    includeTags: false,
    excludeTags: false,
    privateTags: false,
    privateTagPrefixes: false,
    allowedMetaTags: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--config') {
      options.config = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--include-tag') {
      options.includeTags.push(normalizeTag(requireValue(arg, next)));
      cliSpecified.includeTags = true;
      index += 1;
    } else if (arg === '--exclude-tag') {
      options.excludeTags.push(normalizeTag(requireValue(arg, next)));
      cliSpecified.excludeTags = true;
      index += 1;
    } else if (arg === '--out') {
      options.out = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--manifest') {
      options.manifest = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--source-manifest') {
      options.sourceManifest = requireValue(arg, next);
      index += 1;
    } else if (arg === '--tags') {
      options.tags = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--videos-dir') {
      options.videosDir = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--private-tags') {
      options.privateTags = requireValue(arg, next).split(',').map(normalizeTag).filter(Boolean);
      cliSpecified.privateTags = true;
      index += 1;
    } else if (arg === '--private-tag-prefix') {
      options.privateTagPrefixes.push(normalizeTagPrefix(requireValue(arg, next)));
      cliSpecified.privateTagPrefixes = true;
      index += 1;
    } else if (arg === '--allowed-meta-tag') {
      options.allowedMetaTags.push(normalizeTag(requireValue(arg, next)));
      cliSpecified.allowedMetaTags = true;
      index += 1;
    } else if (arg === '--public-base-url') {
      options.publicBaseUrl = requireValue(arg, next);
      cliSpecified.publicBaseUrl = true;
      index += 1;
    } else if (extraOptions.allowUnknown) {
      if (next && !next.startsWith('--')) {
        index += 1;
      }
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  applyConfig(options, cliSpecified);
  options.includeTags = Array.from(new Set(options.includeTags)).filter(Boolean);
  options.excludeTags = Array.from(new Set(['meta:no-public', ...options.excludeTags].map(normalizeTag))).filter(Boolean);
  options.privateTags = Array.from(new Set(options.privateTags)).filter(Boolean);
  options.privateTagPrefixes = Array.from(new Set(options.privateTagPrefixes.map(normalizeTagPrefix))).filter(Boolean);
  options.allowedMetaTags = Array.from(new Set(['meta:public', 'meta:no-public', ...options.allowedMetaTags].map(normalizeTag))).filter(Boolean);
  return options;
}

export function requireValue(option, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function validateOptions(options) {
  if (options.help) return;
  if (!options.out) throw new Error('--out is required');
  if (options.includeTags.length === 0) throw new Error('--include-tag is required to avoid accidental full export');
  if (!/^https:\/\//.test(options.publicBaseUrl)) throw new Error('--public-base-url must start with https://');
}

export function findSourceById(sourceVideos, manifest, publicId) {
  const entry = Object.entries(manifest.videos).find(([, value]) => value.id === publicId);
  if (!entry) return undefined;
  return sourceVideos.find((video) => video.localKey === entry[0]);
}

export function assertWebpThumbnail(source) {
  if (!source.thumbnailPath) {
    throw new Error(`Missing thumbnail: ${source.localKey}`);
  }
  if (path.extname(source.thumbnailPath).toLowerCase() !== '.webp') {
    throw new Error(`Thumbnail must be webp for current gallery URLs: ${source.localKey}`);
  }
}

export function copyPreparedFiles({ exported, sourceVideos, manifest, outDir }) {
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

export function assertEmptyDirectory(dirPath) {
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

  const sourceManifest = resolveSourceManifest(options);
  const sourceVideos = readSourceVideos({ videosDir, sourceManifest });
  const tagsByFilename = readTags(options.tags);
  const manifest = readManifest(options.manifest);
  const { exported, missingThumbnails, candidates, excluded, orphanTagEntries } = buildExport({ sourceVideos, tagsByFilename, manifest, options });

  if (missingThumbnails.length > 0) {
    const examples = missingThumbnails.slice(0, 10).map((item) => `- ${item.id} ${item.playerUrl}`).join('\n');
    throw new Error(`公開候補のサムネイルが未生成です: ${missingThumbnails.length}\n${examples}`);
  }

  const copied = options.dryRun ? [] : copyPreparedFiles({ exported, sourceVideos, manifest, outDir: options.out });
  if (!options.dryRun) {
    writeJson(options.manifest, manifest);
    writeJson(path.join(options.out, 'videos.json'), exported);
    writeJson(path.join(options.out, 'upload-manifest.json'), copied);
  }

  console.log(`Scanned: ${sourceVideos.length}`);
  console.log(`Candidates: ${candidates}`);
  console.log(`Excluded: ${excluded.length}`);
  console.log(`Prepared: ${exported.length}`);
  console.log(`Output: ${options.out}`);
  console.log(`Manifest: ${options.manifest}`);
  console.log(`Video manifest: ${sourceManifest}`);
  if (orphanTagEntries.length > 0) {
    console.log(`manifest に存在しないタグ項目: ${orphanTagEntries.length}`);
  }
  if (excluded.length > 0) {
    console.log(`Excluded tags: ${formatTagCounts(countExcludedTags(excluded))}`);
  }
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
