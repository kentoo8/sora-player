#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  readVideoManifestWithExistingFiles,
  refreshVideoManifest,
  resolveLibraryOptions,
} from '../src/lib/video-library.mjs';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length;
const DEFAULT_PRIVATE_TAGS = ['public', 'private', 'internal'];
const DEFAULT_PRIVATE_TAG_PREFIXES = ['meta:'];
const DEFAULT_ALLOWED_META_TAGS = ['meta:public', 'meta:no-public'];
const DEFAULT_EXCLUDE_TAGS = ['meta:no-public'];
const CONFLICTING_META_TAG_GROUPS = [['meta:public', 'meta:no-public']];

export function printUsage() {
  console.log(`Usage:
  npm run export:gallery -- --public-base-url https://cdn.example.com/sora --include-tag public --out ../sora-gallery/public/videos.json

Options:
  --public-base-url <url>       Required. Base URL where exported video/thumbnail objects will be public.
  --config <path>               Export config path. Default: data/gallery-export-config.json if it exists.
  --include-tag <tag>           Required. Only videos with this local tag are exported. Can be repeated.
  --exclude-tag <tag>           Videos with this local tag are excluded. Can be repeated.
  --out <path>                  Output videos.json path. Default: ../sora-gallery/public/videos.json
  --manifest <path>             Public ID manifest path. Default: data/gallery-export-manifest.json
  --source-manifest <path>      Video manifest path. Default: config manifestPath or <videosDir>/_metadata/manifest.json
  --tags <path>                 Local tags file path. Default: data/tags.json
  --videos-dir <path>           Source videos directory. Default: config.json videosDir, VIDEOS_DIR, or ./videos
  --private-tags <a,b>          Tags removed from public output. Default: public,private,internal
  --private-tag-prefix <prefix> Tags with this prefix are removed from public output. Default: meta:
  --allowed-meta-tag <tag>      Allowed meta tag. Unknown meta:* tags on candidates fail export.
  --dry-run                     Print summary without writing files.
  --help                        Show this help.
`);
}

export function parseArgs(argv) {
  const defaultConfig = path.resolve(process.cwd(), 'data/gallery-export-config.json');
  const options = {
    config: fs.existsSync(defaultConfig) ? defaultConfig : '',
    out: path.resolve(process.cwd(), '../sora-gallery/public/videos.json'),
    manifest: path.resolve(process.cwd(), 'data/gallery-export-manifest.json'),
    sourceManifest: '',
    tags: path.resolve(process.cwd(), 'data/tags.json'),
    includeTags: [],
    excludeTags: [],
    privateTags: DEFAULT_PRIVATE_TAGS,
    privateTagPrefixes: DEFAULT_PRIVATE_TAG_PREFIXES,
    allowedMetaTags: DEFAULT_ALLOWED_META_TAGS,
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
    } else if (arg === '--public-base-url') {
      options.publicBaseUrl = requireValue(arg, next);
      cliSpecified.publicBaseUrl = true;
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
      options.privateTags = splitTags(requireValue(arg, next));
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
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  applyConfig(options, cliSpecified);
  options.includeTags = Array.from(new Set(options.includeTags)).filter(Boolean);
  options.excludeTags = Array.from(new Set([...DEFAULT_EXCLUDE_TAGS, ...options.excludeTags].map(normalizeTag))).filter(Boolean);
  options.privateTags = Array.from(new Set(options.privateTags.map(normalizeTag))).filter(Boolean);
  options.privateTagPrefixes = Array.from(new Set(options.privateTagPrefixes.map(normalizeTagPrefix))).filter(Boolean);
  options.allowedMetaTags = Array.from(new Set([...DEFAULT_ALLOWED_META_TAGS, ...options.allowedMetaTags].map(normalizeTag))).filter(Boolean);
  return options;
}

export function applyConfig(options, cliSpecified) {
  if (!options.config) return;

  const config = readJson(options.config, undefined);
  if (!config) return;
  if (config.version !== 1) throw new Error(`Unsupported gallery export config version: ${options.config}`);

  if (!cliSpecified.publicBaseUrl && typeof config.publicBaseUrl === 'string') {
    options.publicBaseUrl = config.publicBaseUrl;
  }
  if (!cliSpecified.includeTags && config.includeTags !== undefined) {
    options.includeTags = readConfigStringArray(config, 'includeTags', options.config);
  }
  if (!cliSpecified.excludeTags && config.excludeTags !== undefined) {
    options.excludeTags = readConfigStringArray(config, 'excludeTags', options.config);
  }
  if (!cliSpecified.privateTags && config.privateTags !== undefined) {
    options.privateTags = readConfigStringArray(config, 'privateTags', options.config);
  }
  if (!cliSpecified.privateTagPrefixes && config.privateTagPrefixes !== undefined) {
    options.privateTagPrefixes = readConfigStringArray(config, 'privateTagPrefixes', options.config).map(normalizeTagPrefix);
  }
  if (!cliSpecified.allowedMetaTags && config.allowedMetaTags !== undefined) {
    options.allowedMetaTags = readConfigStringArray(config, 'allowedMetaTags', options.config);
  }
}

export function readConfigStringArray(config, field, configPath) {
  if (!Array.isArray(config[field])) throw new Error(`${field} must be an array in ${configPath}`);
  return config[field].map((value) => {
    if (typeof value !== 'string') throw new Error(`${field} must contain only strings in ${configPath}`);
    return value;
  });
}

export function requireValue(option, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function splitTags(value) {
  return value
    .split(',')
    .map(normalizeTag)
    .filter(Boolean);
}

export function normalizeTag(tag) {
  return typeof tag === 'string' ? tag.trim() : '';
}

export function normalizeTagPrefix(prefix) {
  return typeof prefix === 'string' ? prefix.trim() : '';
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map(normalizeTag).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja'));
}

export function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function resolveVideosDir(explicitVideosDir) {
  if (explicitVideosDir) return explicitVideosDir;

  const configPath = path.join(process.cwd(), 'config.json');
  const config = readJson(configPath, {});
  const configuredDir = config.videosDir || process.env.VIDEOS_DIR;
  if (configuredDir) {
    return path.isAbsolute(configuredDir) ? configuredDir : path.resolve(process.cwd(), configuredDir);
  }

  return path.resolve(process.cwd(), 'videos');
}

export function resolveSourceManifest(options) {
  const libraryOptions = resolveLibraryOptions({
    cwd: process.cwd(),
    videosDir: options.videosDir,
    manifestPath: options.sourceManifest,
  });
  return libraryOptions.manifestPath;
}

export function decodeTime(id) {
  if (id.length !== 26) return 0;
  try {
    return id
      .substring(0, 10)
      .split('')
      .reduce((carry, char) => {
        const encodingIndex = ENCODING.indexOf(char.toUpperCase());
        if (encodingIndex === -1) throw new Error('Invalid ULID character');
        return carry * ENCODING_LEN + encodingIndex;
      }, 0);
  } catch {
    return 0;
  }
}

export function createdAtFromVideo(filenameId, meta, fullPath) {
  let timestamp = 0;
  if (meta?.task_id?.startsWith('task_')) {
    timestamp = decodeTime(meta.task_id.replace('task_', ''));
  }
  if (timestamp === 0 && filenameId.startsWith('gen_')) {
    timestamp = decodeTime(filenameId.replace('gen_', ''));
  }
  if (timestamp === 0) {
    timestamp = fs.statSync(fullPath).mtimeMs;
  }
  return new Date(timestamp).toISOString();
}

export function readSourceVideos({ videosDir, sourceManifest }) {
  if (!fs.existsSync(sourceManifest)) {
    throw new Error(`動画 manifest が見つかりません。先に npm run generate:manifest を実行してください: ${sourceManifest}`);
  }
  const result = readVideoManifestWithExistingFiles(sourceManifest, videosDir);
  return result.videos.map((video) => ({
    localKey: video.id,
    filename: video.id,
    id: video.id,
    fullPath: video.fullPath,
    relativePath: video.videoPath,
    videoPath: video.videoPath,
    thumbnailPath: fs.existsSync(video.absoluteThumbnailPath) ? video.absoluteThumbnailPath : '',
    prompt: typeof video.prompt === 'string' ? video.prompt : '',
    description: typeof video.description === 'string' ? video.description : '',
    createdAt: video.createdAt,
  })).sort(compareVideos);
}

export function compareVideos(a, b) {
  const aTime = Date.parse(a.createdAt);
  const bTime = Date.parse(b.createdAt);
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
  if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1;
  return a.localKey.localeCompare(b.localKey);
}

export function readTags(tagsPath) {
  const parsed = readJson(tagsPath, { videos: {} });
  return parsed && typeof parsed.videos === 'object' && parsed.videos !== null ? parsed.videos : {};
}

export function readManifest(manifestPath) {
  const parsed = readJson(manifestPath, { version: 1, videos: {} });
  const videos = parsed && typeof parsed.videos === 'object' && parsed.videos !== null ? parsed.videos : {};
  return { version: 1, videos: migrateGalleryManifestVideos(videos) };
}

export function migrateGalleryManifestVideos(videos) {
  const migrated = {};
  for (const [key, value] of Object.entries(videos)) {
    const normalizedKey = normalizeGalleryManifestKey(key);
    if (!normalizedKey) continue;
    if (migrated[normalizedKey] && migrated[normalizedKey].id !== value.id) {
      throw new Error(`gallery export manifest の移行で ID が衝突しました: ${normalizedKey}`);
    }
    migrated[normalizedKey] = value;
  }
  return migrated;
}

export function normalizeGalleryManifestKey(key) {
  if (typeof key !== 'string') return '';
  if (key.startsWith('gen_')) return key.replace(/\.mp4$/i, '');
  const normalized = key.split('@@').join('/');
  const stem = path.basename(normalized).replace(/\.[^.]+$/i, '');
  return stem.startsWith('gen_') ? stem : '';
}

export function ensureManifestEntry(manifest, video) {
  if (!manifest.videos[video.localKey]) {
    const id = crypto.randomUUID();
    manifest.videos[video.localKey] = {
      id,
      videoObjectKey: `videos/${id}.mp4`,
      thumbnailObjectKey: `thumbnails/${id}.webp`,
    };
  }
  return manifest.videos[video.localKey];
}

export function joinUrl(baseUrl, objectKey) {
  return `${baseUrl.replace(/\/+$/, '')}/${objectKey.replace(/^\/+/, '')}`;
}

export function validateOptions(options) {
  if (options.help) return;
  if (!options.publicBaseUrl) throw new Error('--public-base-url is required');
  if (options.includeTags.length === 0) throw new Error('--include-tag is required to avoid accidental full export');
  if (!/^https:\/\//.test(options.publicBaseUrl)) throw new Error('--public-base-url must start with https://');
  for (const tag of options.allowedMetaTags) {
    if (!isPrivatePrefixTag(tag, options.privateTagPrefixes)) {
      throw new Error(`Allowed meta tag must match a private tag prefix: ${tag}`);
    }
  }
}

export function validateExportedVideo(video) {
  const required = ['id', 'videoUrl', 'thumbnailUrl', 'prompt', 'tags', 'createdAt'];
  for (const field of required) {
    if (!(field in video)) throw new Error(`Exported video is missing ${field}: ${video.id || '(unknown)'}`);
  }
  if (!video.id || typeof video.id !== 'string') throw new Error('Exported video id must be a non-empty string');
  if (!video.videoUrl.startsWith('https://')) throw new Error(`videoUrl must be https: ${video.id}`);
  if (!video.thumbnailUrl.startsWith('https://')) throw new Error(`thumbnailUrl must be https: ${video.id}`);
  if (!Array.isArray(video.tags)) throw new Error(`tags must be an array: ${video.id}`);
}

export function buildExport({ sourceVideos, tagsByFilename, manifest, options }) {
  const includeTagSet = new Set(options.includeTags);
  const excludeTagSet = new Set(options.excludeTags);
  const privateTagSet = new Set(options.privateTags);
  const exported = [];
  const missingThumbnails = [];
  const missingSourceVideos = [];
  const excluded = [];
  const sourceIds = new Set(sourceVideos.map((video) => video.localKey));
  const orphanTagEntries = Object.keys(tagsByFilename)
    .filter((id) => id.startsWith('gen_') && !sourceIds.has(id))
    .sort((a, b) => a.localeCompare(b, 'en'));
  for (const id of orphanTagEntries) {
    const localTags = normalizeTags(tagsByFilename[id]);
    if (!localTags.some((tag) => includeTagSet.has(tag))) continue;
    const matchedExcludeTags = localTags.filter((tag) => excludeTagSet.has(tag));
    if (matchedExcludeTags.length > 0) continue;
    missingSourceVideos.push({
      id,
      tags: localTags,
      reason: 'PUBLIC_CANDIDATE_NOT_FOUND_IN_VIDEO_MANIFEST',
    });
  }
  let candidates = 0;

  for (const source of sourceVideos) {
    const localTags = normalizeTags(tagsByFilename[source.filename]);
    if (!localTags.some((tag) => includeTagSet.has(tag))) continue;
    candidates += 1;

    assertAllowedMetaTags(source, localTags, options);
    assertNoConflictingMetaTags(source, localTags);
    const matchedExcludeTags = localTags.filter((tag) => excludeTagSet.has(tag));
    if (matchedExcludeTags.length > 0) {
      excluded.push({ localKey: source.localKey, tags: matchedExcludeTags });
      continue;
    }

    const manifestEntry = ensureManifestEntry(manifest, source);
    const publicTags = localTags.filter((tag) => !privateTagSet.has(tag) && !isPrivatePrefixTag(tag, options.privateTagPrefixes));
    const video = {
      id: manifestEntry.id,
      videoUrl: joinUrl(options.publicBaseUrl, manifestEntry.videoObjectKey),
      thumbnailUrl: joinUrl(options.publicBaseUrl, manifestEntry.thumbnailObjectKey),
      prompt: source.prompt,
      tags: publicTags,
      createdAt: source.createdAt,
    };

    if (source.description) {
      video.description = source.description;
    }
    if (!source.thumbnailPath) {
      missingThumbnails.push({
        id: source.localKey,
        videoPath: source.videoPath || source.relativePath,
      });
    }

    validateExportedVideo(video);
    exported.push(video);
  }

  exported.sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
    if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return { exported, missingThumbnails, missingSourceVideos, candidates, excluded, orphanTagEntries };
}

export function formatMissingSourceVideos(missingSourceVideos) {
  return missingSourceVideos
    .slice(0, 10)
    .map((item) => `- ${item.id} tags=${item.tags.join(', ')}`)
    .join('\n');
}

export function buildMissingSourceVideosError(missingSourceVideos, { tagsPath, sourceManifest, videosDir } = {}) {
  const examples = formatMissingSourceVideos(missingSourceVideos);
  const moreCount = missingSourceVideos.length > 10 ? `\n...他 ${missingSourceVideos.length - 10} 件` : '';
  const tagsPathLine = tagsPath ? `\nタグファイル: ${tagsPath}` : '';
  const sourceManifestLine = sourceManifest ? `\n動画 manifest: ${sourceManifest}` : '';
  const videosDirLine = videosDir ? `\n動画フォルダ: ${videosDir}` : '';

  return (
    `公開候補タグが付いているのに、動画 manifest に存在しない動画があります: ${missingSourceVideos.length}\n` +
    `${examples}${moreCount}\n\n` +
    'これは多くの場合、data/tags.json にタグだけ残っていて、対応する動画ファイルが動画フォルダにない状態です。' +
    `${tagsPathLine}${sourceManifestLine}${videosDirLine}\n\n` +
    '次にやること:\n' +
    '1. この動画を公開したい場合: 動画ファイルを動画フォルダへ戻してください。\n' +
    '2. この動画を公開しない場合: data/tags.json から上記 ID のタグ項目を削除するか、その項目に meta:no-public を付けてください。\n' +
    '3. どちらか対応した後、同じ gallery export / upload / sync コマンドを再実行してください。'
  );
}

export function formatMissingThumbnails(missingThumbnails) {
  return missingThumbnails
    .slice(0, 10)
    .map((item) => `- ${item.id} videoPath=${item.videoPath}`)
    .join('\n');
}

export function buildMissingThumbnailsError(missingThumbnails, { videosDir, sourceManifest } = {}) {
  const examples = formatMissingThumbnails(missingThumbnails);
  const moreCount = missingThumbnails.length > 10 ? `\n...他 ${missingThumbnails.length - 10} 件` : '';
  const sourceManifestLine = sourceManifest ? `\n動画 manifest: ${sourceManifest}` : '';
  const videosDirLine = videosDir ? `\n動画フォルダ: ${videosDir}` : '';

  return (
    `公開候補のサムネイルが未生成です: ${missingThumbnails.length}\n` +
    `${examples}${moreCount}\n\n` +
    'sora-gallery は公開用 thumbnailUrl が必須なので、サムネイルがない動画は export / upload / sync できません。' +
    `${sourceManifestLine}${videosDirLine}\n\n` +
    '次にやること:\n' +
    '1. npm run generate:gallery-thumbnails -- --config data/gallery-export-config.json\n' +
    '2. 同じ gallery export / upload / sync コマンドを再実行してください。\n\n' +
    'ブラウザで確認したい場合だけ http://localhost:3000 を開き、上記 ID を検索してください。\n' +
    'この動画を公開しない場合は、対象動画の公開候補タグを外すか、meta:no-public を付けてから再実行してください。\n' +
    'plan:gallery-sync では --fix-thumbnails を付けると、未生成サムネイルの生成を試してから同期計画を続行できます。'
  );
}

export function isPrivatePrefixTag(tag, prefixes) {
  return prefixes.some((prefix) => prefix && tag.startsWith(prefix));
}

export function assertAllowedMetaTags(source, localTags, options) {
  const allowed = new Set(options.allowedMetaTags);
  const unknown = localTags.filter((tag) => isPrivatePrefixTag(tag, options.privateTagPrefixes) && !allowed.has(tag));
  if (unknown.length > 0) {
    throw new Error(`Unknown meta tag(s) on ${source.localKey}: ${unknown.join(', ')}`);
  }
}

export function assertNoConflictingMetaTags(source, localTags) {
  const tagSet = new Set(localTags);
  for (const group of CONFLICTING_META_TAG_GROUPS) {
    const found = group.filter((tag) => tagSet.has(tag));
    if (found.length > 1) {
      throw new Error(`Conflicting meta tags on ${source.localKey}: ${found.join(', ')}`);
    }
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
  refreshVideoManifest({ videosDir, manifestPath: sourceManifest });
  const sourceVideos = readSourceVideos({ videosDir, sourceManifest });
  const tagsByFilename = readTags(options.tags);
  const manifest = readManifest(options.manifest);
  const { exported, missingThumbnails, missingSourceVideos, candidates, excluded, orphanTagEntries } = buildExport({ sourceVideos, tagsByFilename, manifest, options });

  if (missingSourceVideos.length > 0) {
    throw new Error(buildMissingSourceVideosError(missingSourceVideos, {
      tagsPath: options.tags,
      sourceManifest,
      videosDir,
    }));
  }

  if (missingThumbnails.length > 0) {
    throw new Error(buildMissingThumbnailsError(missingThumbnails, {
      sourceManifest,
      videosDir,
    }));
  }

  if (!options.dryRun) {
    writeJson(options.manifest, manifest);
    writeJson(options.out, exported);
  }

  console.log(`Scanned: ${sourceVideos.length}`);
  console.log(`Candidates: ${candidates}`);
  console.log(`Excluded: ${excluded.length}`);
  console.log(`Exported: ${exported.length}`);
  console.log(`Output: ${options.out}`);
  console.log(`Manifest: ${options.manifest}`);
  console.log(`Video manifest: ${sourceManifest}`);
  if (orphanTagEntries.length > 0) {
    console.log(`manifest に存在しないタグ項目: ${orphanTagEntries.length}`);
  }
  if (excluded.length > 0) {
    const counts = countExcludedTags(excluded);
    console.log(`Excluded tags: ${formatTagCounts(counts)}`);
  }
  console.log('Export gallery succeeded!');
}

export function countExcludedTags(excluded) {
  const counts = new Map();
  for (const item of excluded) {
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

export function formatTagCounts(counts) {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([tag, count]) => `${tag}=${count}`)
    .join(', ');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
