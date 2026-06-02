#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { defaultGalleryOutputDir } from '../src/lib/gallery-output.mjs';

function printUsage() {
  console.log(`Usage:
  npm run delete:gallery-objects
  npm run delete:gallery-objects -- --apply

Options:
  --manifest <path>             Delete manifest path. Default: gallery sync output delete-manifest.json
  --apply                       Delete the listed R2 objects. Without this option, only print the targets.
  --help                        Show this help.
`);
}

export function parseArgs(argv) {
  const options = {
    manifest: path.join(defaultGalleryOutputDir('gallery-sync'), 'delete-manifest.json'),
    apply: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help') {
      options.help = true;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--manifest') {
      if (!next || next.startsWith('--')) throw new Error('--manifest requires a value');
      options.manifest = path.resolve(process.cwd(), next);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export function readObjectKeys(manifestPath) {
  const items = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(items)) throw new Error(`Delete manifest must be an array: ${manifestPath}`);
  return items.flatMap((item) => [item.videoObjectKey, item.thumbnailObjectKey]).filter(Boolean);
}

export function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const keys = readObjectKeys(options.manifest);
  console.log(`Delete targets: ${keys.length}`);
  for (const key of keys) console.log(`- ${key}`);
  if (!options.apply) {
    console.log('Dry run: add --apply to delete these R2 objects.');
    return;
  }
  for (const key of keys) {
    const result = spawnSync('rclone', ['deletefile', `r2:sora-gallery-media/${key}`], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Failed to delete R2 object: ${key}`);
  }
  console.log('Delete gallery objects succeeded!');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
