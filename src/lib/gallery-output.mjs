import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER_FILENAME = '.sora-player-gallery-output.json';
const MARKER_VERSION = 1;

export function defaultGalleryOutputDir(type) {
  return path.join(os.tmpdir(), `sora-player-${type}`);
}

export function prepareGalleryOutputDir(outDir, type) {
  const absoluteOutDir = path.resolve(outDir);
  assertSafeOutputDir(absoluteOutDir);

  if (!fs.existsSync(absoluteOutDir)) {
    fs.mkdirSync(absoluteOutDir, { recursive: true });
    writeMarker(absoluteOutDir, type);
    return;
  }

  const entries = fs.readdirSync(absoluteOutDir);
  if (entries.length === 0) {
    writeMarker(absoluteOutDir, type);
    return;
  }

  const marker = readMarker(absoluteOutDir);
  if (!marker || marker.version !== MARKER_VERSION || marker.type !== type) {
    throw new Error(`Output directory is not managed by sora-player ${type}: ${absoluteOutDir}`);
  }

  for (const entry of entries) {
    fs.rmSync(path.join(absoluteOutDir, entry), { recursive: true, force: true });
  }
  writeMarker(absoluteOutDir, type);
}

function assertSafeOutputDir(outDir) {
  const forbidden = new Set([
    path.parse(outDir).root,
    path.resolve(os.homedir()),
    path.resolve(process.cwd()),
  ]);
  if (forbidden.has(outDir)) {
    throw new Error(`Refusing to use unsafe output directory: ${outDir}`);
  }
}

function markerPath(outDir) {
  return path.join(outDir, MARKER_FILENAME);
}

function readMarker(outDir) {
  try {
    return JSON.parse(fs.readFileSync(markerPath(outDir), 'utf8'));
  } catch {
    return undefined;
  }
}

function writeMarker(outDir, type) {
  fs.writeFileSync(markerPath(outDir), `${JSON.stringify({ version: MARKER_VERSION, type }, null, 2)}\n`);
}
