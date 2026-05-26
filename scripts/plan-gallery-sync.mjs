#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  buildExport,
  buildMissingSourceVideosError,
  buildMissingThumbnailsError,
  countExcludedTags,
  formatTagCounts,
  readManifest,
  readSourceVideos,
  readTags,
  resolveVideosDir,
  resolveSourceManifest,
  writeJson,
} from './export-gallery.mjs';
import {
  assertWebpThumbnail,
  findSourceById,
  parseArgs as parsePrepareArgs,
} from './prepare-gallery-upload.mjs';
import {
  generateMissingGalleryThumbnails,
  printGalleryThumbnailSummary,
} from './generate-gallery-thumbnails.mjs';

function printUsage() {
  console.log(`Usage:
  npm run plan:gallery-sync -- --config data/gallery-export-config.json --previous ../sora-gallery/public/videos.json --out /private/tmp/sora-gallery-sync

Options:
  --previous <path>             Required. Previous published public/videos.json.
  --out <path>                  Required. Sync plan output directory.
  --config <path>               Export config path. Default: data/gallery-export-config.json if it exists.
  --manifest <path>             Public ID manifest path. Default: data/gallery-export-manifest.json
  --source-manifest <path>      Video manifest path. Default: config manifestPath or <videosDir>/_metadata/manifest.json
  --tags <path>                 Local tags file path. Default: data/tags.json
  --videos-dir <path>           Source videos directory. Default: config.json videosDir, VIDEOS_DIR, or ./videos
  --fix-thumbnails              Generate missing candidate thumbnails before continuing.
  --dry-run                     Print summary without copying files or writing manifest.
  --help                        Show this help.
`);
}

function parseArgs(argv) {
  const options = parsePrepareArgs(argv, { allowUnknown: true });
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--previous') {
      options.previous = path.resolve(process.cwd(), requireValue(arg, next));
      index += 1;
    } else if (arg === '--fix-thumbnails') {
      options.fixThumbnails = true;
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
  if (!options.previous) throw new Error('--previous is required');
  if (!options.out) throw new Error('--out is required');
  if (options.includeTags.length === 0) throw new Error('--include-tag is required to avoid accidental full export');
  if (!/^https:\/\//.test(options.publicBaseUrl)) throw new Error('--public-base-url must start with https://');
}

function readVideosJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Previous videos.json does not exist: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Previous videos.json must be an array: ${filePath}`);
  }
  return parsed;
}

function stableVideoJson(video) {
  return JSON.stringify({
    id: video.id,
    videoUrl: video.videoUrl,
    thumbnailUrl: video.thumbnailUrl,
    prompt: video.prompt,
    tags: video.tags,
    createdAt: video.createdAt,
    description: video.description,
  });
}

function buildSyncPlan({ previous, next }) {
  const previousById = new Map(previous.map((video) => [video.id, video]));
  const nextById = new Map(next.map((video) => [video.id, video]));
  const upload = next.filter((video) => !previousById.has(video.id));
  const remove = previous.filter((video) => !nextById.has(video.id));
  const changedMetadata = next
    .filter((video) => previousById.has(video.id))
    .filter((video) => stableVideoJson(previousById.get(video.id)) !== stableVideoJson(video));
  const unchanged = next
    .filter((video) => previousById.has(video.id))
    .filter((video) => stableVideoJson(previousById.get(video.id)) === stableVideoJson(video));

  return { upload, remove, changedMetadata, unchanged };
}

function assertEmptyDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath);
  if (entries.length > 0) {
    throw new Error(`Output directory must be empty: ${dirPath}`);
  }
}

function copyUploadFiles({ upload, sourceVideos, manifest, outDir }) {
  const videosOutDir = path.join(outDir, 'videos');
  const thumbnailsOutDir = path.join(outDir, 'thumbnails');
  assertEmptyDirectory(videosOutDir);
  assertEmptyDirectory(thumbnailsOutDir);
  fs.mkdirSync(videosOutDir, { recursive: true });
  fs.mkdirSync(thumbnailsOutDir, { recursive: true });

  const copied = [];
  for (const video of upload) {
    const source = findSourceById(sourceVideos, manifest, video.id);
    if (!source) {
      throw new Error(`Missing source for upload video: ${video.id}`);
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
      videoObjectKey: manifestEntry.videoObjectKey,
      thumbnailObjectKey: manifestEntry.thumbnailObjectKey,
    });
  }
  return copied;
}

function buildDeleteManifest(videos) {
  return videos.map((video) => {
    const videoUrl = new URL(video.videoUrl);
    const thumbnailUrl = new URL(video.thumbnailUrl);
    return {
      id: video.id,
      videoObjectKey: videoUrl.pathname.replace(/^\/+/, ''),
      thumbnailObjectKey: thumbnailUrl.pathname.replace(/^\/+/, ''),
      videoUrl: video.videoUrl,
      thumbnailUrl: video.thumbnailUrl,
    };
  });
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

  const previous = readVideosJson(options.previous);
  const sourceManifest = resolveSourceManifest(options);
  let sourceVideos = readSourceVideos({ videosDir, sourceManifest });
  const tagsByFilename = readTags(options.tags);
  const manifest = readManifest(options.manifest);
  let exportResult = buildExport({
    sourceVideos,
    tagsByFilename,
    manifest,
    options,
  });
  let { exported, missingThumbnails, missingSourceVideos, candidates, excluded, orphanTagEntries } = exportResult;

  if (missingSourceVideos.length > 0) {
    throw new Error(buildMissingSourceVideosError(missingSourceVideos, {
      tagsPath: options.tags,
      sourceManifest,
      videosDir,
    }));
  }

  if (missingThumbnails.length > 0 && options.fixThumbnails) {
    const thumbnailResult = generateMissingGalleryThumbnails({
      sourceVideos,
      missingThumbnails,
      videosDir,
      seek: 0.1,
    });
    printGalleryThumbnailSummary({
      ...thumbnailResult,
      sourceManifest,
      exportResult,
    });
    if (thumbnailResult.failed.length > 0) {
      throw new Error('未生成サムネイルを自動生成できない動画があります。上記の Failed 一覧を確認してください。');
    }
    sourceVideos = readSourceVideos({ videosDir, sourceManifest });
    exportResult = buildExport({
      sourceVideos,
      tagsByFilename,
      manifest,
      options,
    });
    ({ exported, missingThumbnails, missingSourceVideos, candidates, excluded, orphanTagEntries } = exportResult);
  }

  if (missingThumbnails.length > 0) {
    throw new Error(buildMissingThumbnailsError(missingThumbnails, {
      sourceManifest,
      videosDir,
    }));
  }

  const plan = buildSyncPlan({ previous, next: exported });
  const uploadManifest = options.dryRun
    ? plan.upload.map((video) => ({ id: video.id }))
    : copyUploadFiles({ upload: plan.upload, sourceVideos, manifest, outDir: options.out });
  const deleteManifest = buildDeleteManifest(plan.remove);

  if (!options.dryRun) {
    writeJson(options.manifest, manifest);
    writeJson(path.join(options.out, 'videos.json'), exported);
    writeJson(path.join(options.out, 'upload-manifest.json'), uploadManifest);
    writeJson(path.join(options.out, 'delete-manifest.json'), deleteManifest);
    writeJson(path.join(options.out, 'changed-metadata.json'), plan.changedMetadata);
    writeJson(path.join(options.out, 'unchanged.json'), plan.unchanged);
  }

  console.log(`Scanned: ${sourceVideos.length}`);
  console.log(`Candidates: ${candidates}`);
  console.log(`Excluded: ${excluded.length}`);
  console.log(`Previous: ${previous.length}`);
  console.log(`Next: ${exported.length}`);
  console.log(`Upload: ${plan.upload.length}`);
  console.log(`Delete: ${plan.remove.length}`);
  console.log(`Changed metadata: ${plan.changedMetadata.length}`);
  console.log(`Unchanged: ${plan.unchanged.length}`);
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
  console.log('Plan gallery sync succeeded!');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
