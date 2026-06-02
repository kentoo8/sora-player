import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const VIDEO_MANIFEST_VERSION = 1;
export const DEFAULT_DUPLICATE_STRATEGY = 'prefer-oldest';
export const DUPLICATE_STRATEGIES = new Set(['manual', 'prefer-oldest', 'prefer-newest']);
export const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ENCODING_LEN = ENCODING.length;
export const IGNORED_SCAN_DIRECTORIES = new Set(['_thumbnails', '_metadata', '_reports', '_maintenance']);

export class VideoLibraryError extends Error {
  constructor(message, { report } = {}) {
    super(message);
    this.name = 'VideoLibraryError';
    this.report = report;
  }
}

export function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readPlayerConfig(cwd = process.cwd()) {
  return readJson(path.join(cwd, 'config.json'), {});
}

export function expandHomePath(filePath) {
  if (typeof filePath !== 'string') return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

export function resolveVideosDir(explicitVideosDir, cwd = process.cwd()) {
  if (explicitVideosDir) {
    const expandedDir = expandHomePath(explicitVideosDir);
    return path.isAbsolute(expandedDir) ? expandedDir : path.resolve(cwd, expandedDir);
  }
  const config = readPlayerConfig(cwd);
  const configuredDir = config.videosDir || process.env.VIDEOS_DIR;
  if (configuredDir) {
    const expandedDir = expandHomePath(configuredDir);
    return path.isAbsolute(expandedDir) ? expandedDir : path.resolve(cwd, expandedDir);
  }
  return path.resolve(cwd, 'videos');
}

export function resolveArchivePath({ videosDir, value, defaultRelative }) {
  const pathValue = expandHomePath(value || defaultRelative);
  if (path.isAbsolute(pathValue)) return pathValue;
  return path.resolve(videosDir, pathValue);
}

export function normalizeDuplicateStrategy(strategy = DEFAULT_DUPLICATE_STRATEGY) {
  const normalized = typeof strategy === 'string' && strategy.trim() ? strategy.trim() : DEFAULT_DUPLICATE_STRATEGY;
  if (!DUPLICATE_STRATEGIES.has(normalized)) {
    throw new Error(`duplicateStrategy が不正です: ${normalized}`);
  }
  return normalized;
}

export function resolveLibraryOptions({
  cwd = process.cwd(),
  videosDir,
  manifestPath,
  reportPath,
  duplicateStrategy,
} = {}) {
  const config = readPlayerConfig(cwd);
  const resolvedVideosDir = resolveVideosDir(videosDir || config.videosDir, cwd);
  return {
    videosDir: resolvedVideosDir,
    manifestPath: resolveArchivePath({
      videosDir: resolvedVideosDir,
      value: manifestPath || config.manifestPath,
      defaultRelative: '_metadata/manifest.json',
    }),
    reportPath: resolveArchivePath({
      videosDir: resolvedVideosDir,
      value: reportPath || config.reportPath,
      defaultRelative: '_reports/scan-report.json',
    }),
    duplicateStrategy: normalizeDuplicateStrategy(duplicateStrategy || config.duplicateStrategy || DEFAULT_DUPLICATE_STRATEGY),
  };
}

export function toPosixRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
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

function normalizeDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value !== 'string' || !value.trim()) return '';
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && /^\d+$/.test(value.trim())) return new Date(asNumber).toISOString();
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export function createdAtFromVideo(id, meta, fullPath, report) {
  const candidates = [];
  for (const field of ['createdAt', 'created_at', 'createTime', 'create_time']) {
    const iso = normalizeDate(meta?.[field]);
    if (iso) candidates.push({ source: field, iso });
  }
  if (meta?.task_id?.startsWith('task_')) {
    const time = decodeTime(meta.task_id.replace('task_', ''));
    if (time) candidates.push({ source: 'task_id', iso: new Date(time).toISOString() });
  }
  if (id.startsWith('gen_')) {
    const time = decodeTime(id.replace('gen_', ''));
    if (time) candidates.push({ source: 'video_id', iso: new Date(time).toISOString() });
  }
  const mtimeIso = new Date(fs.statSync(fullPath).mtimeMs).toISOString();
  candidates.push({ source: 'mtime', iso: mtimeIso });

  const primary = candidates[0];
  for (const candidate of candidates.slice(1, 3)) {
    if (Math.abs(Date.parse(primary.iso) - Date.parse(candidate.iso)) > 60_000) {
      report.createdAtMismatches.push({
        id,
        reason: 'CREATED_AT_CANDIDATES_DIFFER',
        message: 'createdAt の候補値に差異があります。',
        candidates,
      });
      break;
    }
  }
  return primary.iso;
}

function createReport(videosDir) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    videosDir,
    metadataMissingVideos: [],
    missingVideoFiles: [],
    nonGenVideoFiles: [],
    unsupportedVideoFiles: [],
    duplicateVideoIds: [],
    duplicateResolutions: [],
    manifestMissingFiles: [],
    missingThumbnails: [],
    createdAtMismatches: [],
    orphanTagEntries: [],
  };
}

function readGenerationItems(metaPath) {
  const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`generations.json は配列である必要があります: ${metaPath}`);
  }
  return parsed;
}

function compareCandidateTime(a, b) {
  const aTime = Date.parse(a.createdAt) || fs.statSync(a.fullPath).mtimeMs;
  const bTime = Date.parse(b.createdAt) || fs.statSync(b.fullPath).mtimeMs;
  return aTime - bTime;
}

function resolveDuplicates(groups, strategy, report) {
  const videos = [];
  for (const [id, candidates] of groups.entries()) {
    if (candidates.length === 1) {
      videos.push(candidates[0]);
      continue;
    }
    const paths = candidates.map((candidate) => candidate.videoPath);
    if (strategy === 'manual') {
      report.duplicateVideoIds.push({
        id,
        reason: 'DUPLICATE_VIDEO_ID',
        message: '同じ動画 ID のファイルが複数見つかりました。',
        candidates: paths,
      });
      continue;
    }
    const sorted = [...candidates].sort(compareCandidateTime);
    const selected = strategy === 'prefer-newest' ? sorted[sorted.length - 1] : sorted[0];
    videos.push(selected);
    report.duplicateResolutions.push({
      id,
      reason: 'DUPLICATE_VIDEO_ID_RESOLVED',
      message: `重複動画を ${strategy} で自動解決しました。`,
      strategy,
      selected: selected.videoPath,
      ignored: sorted.filter((candidate) => candidate !== selected).map((candidate) => candidate.videoPath),
      candidates: paths,
    });
  }
  if (report.duplicateVideoIds.length > 0) {
    const details = report.duplicateVideoIds
      .map((item) => [`- ${item.id}`, ...item.candidates.map((candidate) => `  - ${candidate}`)].join('\n'))
      .join('\n');
    throw new VideoLibraryError(
      `重複した動画 ID が見つかりました。\n\n${details}\n\n` +
        '自動で選ぶ場合は --duplicate-strategy prefer-oldest または prefer-newest を指定してください。' +
        '手動補正する場合は不要なファイルを _maintenance/ などへ移動してから再実行してください。',
      { report },
    );
  }
  return videos;
}

export function scanVideoLibrary({ videosDir, duplicateStrategy = DEFAULT_DUPLICATE_STRATEGY } = {}) {
  const absoluteVideosDir = path.resolve(videosDir);
  const normalizedDuplicateStrategy = normalizeDuplicateStrategy(duplicateStrategy);
  const report = createReport(absoluteVideosDir);
  const groups = new Map();
  const generationFolders = [];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const metaPath = path.join(dir, 'generations.json');
    let metadataMap;
    if (fs.existsSync(metaPath)) {
      try {
        const items = readGenerationItems(metaPath);
        metadataMap = new Map(items.filter((item) => item?.id).map((item) => [item.id, item]));
        generationFolders.push({ dir, metaPath, metadataMap, seenVideoIds: new Set() });
      } catch (error) {
        throw new Error(`generations.json を読み込めません: ${toPosixRelative(absoluteVideosDir, metaPath)}\n${error.message}`);
      }
    }
    const generationFolder = generationFolders.find((folder) => folder.dir === dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_SCAN_DIRECTORIES.has(entry.name)) scanDir(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === 'generations.json') continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!['.mp4', '.mov', '.m4v', '.webm'].includes(ext)) continue;
      const videoPath = toPosixRelative(absoluteVideosDir, fullPath);
      if (ext !== '.mp4') {
        report.unsupportedVideoFiles.push({
          videoPath,
          reason: 'UNSUPPORTED_VIDEO_EXTENSION',
          message: 'mp4 以外の動画ファイルは対象外です。',
        });
        continue;
      }
      const id = path.basename(entry.name, ext);
      if (!id.startsWith('gen_')) {
        report.nonGenVideoFiles.push({
          id,
          videoPath,
          reason: 'NON_GEN_VIDEO_ID',
          message: 'gen_ で始まらない動画 ID のため除外しました。',
        });
        continue;
      }
      const meta = metadataMap?.get(id);
      if (metadataMap && !meta) {
        report.metadataMissingVideos.push({
          id,
          videoPath,
          sourceGenerationJson: toPosixRelative(absoluteVideosDir, metaPath),
          reason: 'VIDEO_ID_NOT_FOUND_IN_GENERATIONS_JSON',
          message: 'generations.json に同じ ID がないため除外しました。',
        });
        continue;
      }
      generationFolder?.seenVideoIds.add(id);
      const thumbnailPath = `_thumbnails/${id}.webp`;
      const absoluteThumbnailPath = path.join(absoluteVideosDir, thumbnailPath);
      const video = {
        id,
        filename: id,
        videoPath,
        fullPath,
        thumbnailPath,
        absoluteThumbnailPath,
        title: typeof meta?.title === 'string' ? meta.title : '',
        description: typeof meta?.description === 'string' ? meta.description : '',
        prompt: typeof meta?.prompt === 'string' ? meta.prompt : '',
        taskId: typeof meta?.task_id === 'string' ? meta.task_id : '',
        sourceGenerationJson: metadataMap ? toPosixRelative(absoluteVideosDir, metaPath) : '',
        createdAt: createdAtFromVideo(id, meta, fullPath, report),
      };
      if (!fs.existsSync(absoluteThumbnailPath)) {
        report.missingThumbnails.push({
          id,
          videoPath,
          thumbnailPath,
          reason: 'THUMBNAIL_NOT_FOUND',
          message: 'サムネイルがまだ生成されていません。',
        });
      }
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(video);
    }
  }

  scanDir(absoluteVideosDir);

  for (const folder of generationFolders) {
    for (const id of folder.metadataMap.keys()) {
      if (!folder.seenVideoIds.has(id)) {
        report.missingVideoFiles.push({
          id,
          sourceGenerationJson: toPosixRelative(absoluteVideosDir, folder.metaPath),
          reason: 'GENERATION_ID_HAS_NO_VIDEO_FILE',
          message: 'generations.json に ID はありますが、対応する動画ファイルがありません。',
        });
      }
    }
  }

  const videos = resolveDuplicates(groups, normalizedDuplicateStrategy, report).sort(compareVideos);
  return { videos, report };
}

export function compareVideos(a, b) {
  const aTime = Date.parse(a.createdAt);
  const bTime = Date.parse(b.createdAt);
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
  return a.id.localeCompare(b.id, 'en');
}

export function buildVideoManifest({ videosDir, duplicateStrategy } = {}) {
  const absoluteVideosDir = path.resolve(videosDir);
  const { videos, report } = scanVideoLibrary({
    videosDir: absoluteVideosDir,
    duplicateStrategy: normalizeDuplicateStrategy(duplicateStrategy),
  });
  return {
    manifest: {
      version: VIDEO_MANIFEST_VERSION,
      generatedAt: new Date().toISOString(),
      videosDir: absoluteVideosDir,
      videos: videos.map((video) => ({
        id: video.id,
        videoPath: video.videoPath,
        thumbnailPath: video.thumbnailPath,
        title: video.title,
        description: video.description,
        prompt: video.prompt,
        createdAt: video.createdAt,
        taskId: video.taskId,
        sourceGenerationJson: video.sourceGenerationJson,
      })),
    },
    report,
  };
}

export function refreshVideoManifest({ videosDir, manifestPath, reportPath, duplicateStrategy } = {}) {
  const options = resolveLibraryOptions({
    videosDir,
    manifestPath,
    reportPath,
    duplicateStrategy,
  });
  const result = buildVideoManifest({
    videosDir: options.videosDir,
    duplicateStrategy: options.duplicateStrategy,
  });
  writeJson(options.manifestPath, result.manifest);
  writeJson(options.reportPath, result.report);
  return result;
}

export function readVideoManifest(manifestPath) {
  const manifest = readJson(manifestPath);
  if (!manifest || manifest.version !== VIDEO_MANIFEST_VERSION || !Array.isArray(manifest.videos)) {
    throw new Error(`未対応または壊れた動画 manifest です: ${manifestPath}`);
  }
  return manifest;
}

export function readVideoManifestWithExistingFiles(manifestPath, videosDir) {
  const manifest = readVideoManifest(manifestPath);
  const rootDir = path.resolve(videosDir || manifest.videosDir);
  const report = createReport(rootDir);
  const videos = [];
  for (const video of manifest.videos) {
    const fullPath = path.resolve(rootDir, video.videoPath);
    if (!fs.existsSync(fullPath)) {
      report.manifestMissingFiles.push({
        id: video.id,
        videoPath: video.videoPath,
        reason: 'MANIFEST_VIDEO_FILE_NOT_FOUND',
        message: 'manifest に記載された動画ファイルが見つかりません。',
      });
      continue;
    }
    const thumbnailPath = video.thumbnailPath || `_thumbnails/${video.id}.webp`;
    videos.push({
      ...video,
      filename: video.id,
      fullPath,
      thumbnailPath,
      absoluteThumbnailPath: path.resolve(rootDir, thumbnailPath),
    });
  }
  return { manifest, videos, report, videosDir: rootDir };
}

export function reportHasWarnings(report) {
  return Object.values(report).some((value) => Array.isArray(value) && value.length > 0);
}

export function printReportSummary(report) {
  const items = [
    ['generations.json にない動画', report.metadataMissingVideos.length],
    ['動画ファイルがない generation ID', report.missingVideoFiles.length],
    ['gen_ 以外の動画', report.nonGenVideoFiles.length],
    ['未対応拡張子の動画', report.unsupportedVideoFiles.length],
    ['サムネイル未生成', report.missingThumbnails.length],
    ['manifest 記載ファイル欠落', report.manifestMissingFiles.length],
    ['孤立タグ', report.orphanTagEntries.length],
  ].filter(([, count]) => count > 0);
  if (items.length === 0) return;
  console.log('警告:');
  for (const [label, count] of items) console.log(`- ${label}: ${count}`);
}
