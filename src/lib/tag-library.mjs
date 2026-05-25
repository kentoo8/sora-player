import fs from 'node:fs';
import path from 'node:path';

export function getTagsPaths(cwd = process.cwd()) {
  const dataDir = path.join(cwd, 'data');
  return {
    dataDir,
    tagsPath: path.join(dataDir, 'tags.json'),
  };
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  return Array.from(
    new Set(
      tags
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, 'ja'));
}

export function normalizeFilenames(filenames) {
  return Array.isArray(filenames)
    ? filenames.filter((filename) => typeof filename === 'string' && filename.trim().length > 0)
    : [];
}

export function normalizeTagUpdates(updates) {
  return Array.isArray(updates)
    ? updates
        .filter((update) => (
          update &&
          typeof update === 'object' &&
          'filename' in update &&
          typeof update.filename === 'string' &&
          update.filename.trim().length > 0
        ))
        .map((update) => ({ filename: update.filename, tags: normalizeTags(update.tags) }))
    : [];
}

export function normalizeTagsFile(parsed) {
  const videos = parsed && typeof parsed.videos === 'object' && parsed.videos !== null
    ? parsed.videos
    : {};

  return {
    version: 1,
    videos: Object.fromEntries(
      Object.entries(videos)
        .filter(([filename]) => filename)
        .map(([filename, tags]) => [filename, normalizeTags(tags)])
        .filter(([, tags]) => tags.length > 0),
    ),
  };
}

export function readTagsFile(tagsPath = getTagsPaths().tagsPath) {
  if (!fs.existsSync(tagsPath)) {
    return { version: 1, videos: {} };
  }

  return normalizeTagsFile(JSON.parse(fs.readFileSync(tagsPath, 'utf8')));
}

export function writeTagsFile(tagsFile, paths = getTagsPaths()) {
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.tagsPath, `${JSON.stringify(tagsFile, null, 2)}\n`);
}

export function addTagsToVideos(tagsFile, filenames, tags) {
  const nextTags = normalizeTags(tags);
  const targetFilenames = normalizeFilenames(filenames);
  if (targetFilenames.length === 0 || nextTags.length === 0) return false;

  for (const filename of targetFilenames) {
    tagsFile.videos[filename] = normalizeTags([
      ...(tagsFile.videos[filename] || []),
      ...nextTags,
    ]);
  }

  return true;
}

export function replaceTagsForVideos(tagsFile, filenames, tags, updates) {
  const targetFilenames = normalizeFilenames(filenames);
  const nextTags = normalizeTags(tags);
  const targetUpdates = normalizeTagUpdates(updates);
  if (targetFilenames.length === 0 && targetUpdates.length === 0) return false;

  for (const { filename, tags: updateTags } of targetUpdates) {
    if (updateTags.length > 0) {
      tagsFile.videos[filename] = updateTags;
    } else {
      delete tagsFile.videos[filename];
    }
  }

  for (const filename of targetFilenames) {
    if (nextTags.length > 0) {
      tagsFile.videos[filename] = nextTags;
    } else {
      delete tagsFile.videos[filename];
    }
  }

  return true;
}

export function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
