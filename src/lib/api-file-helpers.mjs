import fs from 'node:fs';
import path from 'node:path';

export function isPathInsideDirectory(filePath, directoryPath) {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function resolveExistingVideosDir(configuredVideosDir, cwd = process.cwd()) {
  if (fs.existsSync(configuredVideosDir)) return configuredVideosDir;

  const defaultDir = path.join(cwd, 'videos');
  return fs.existsSync(defaultDir) ? defaultDir : undefined;
}

export function resolveArchivePathForVideosDir(filePath, originalVideosDir, videosDir) {
  if (videosDir === originalVideosDir) return filePath;

  const relativePath = path.relative(originalVideosDir, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return filePath;
  return path.resolve(videosDir, relativePath);
}

export function resolveRuntimeLibraryOptions(options, cwd = process.cwd()) {
  const videosDir = resolveExistingVideosDir(options.videosDir, cwd);
  if (!videosDir) return undefined;

  return {
    ...options,
    videosDir,
    manifestPath: resolveArchivePathForVideosDir(options.manifestPath, options.videosDir, videosDir),
    reportPath: resolveArchivePathForVideosDir(options.reportPath, options.videosDir, videosDir),
  };
}

export function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
