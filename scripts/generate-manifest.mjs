#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  buildVideoManifest,
  normalizeDuplicateStrategy,
  printReportSummary,
  resolveLibraryOptions,
  writeJson,
} from '../src/lib/video-library.mjs';

function printUsage() {
  console.log(`Usage:
  npm run generate:manifest

Options:
  --videos-dir <path>                 Source videos directory. Default: config.json videosDir, VIDEOS_DIR, or ./videos
  --out <path>                        Video manifest path. Default: <videosDir>/_metadata/manifest.json
  --report <path>                     Scan report path. Default: <videosDir>/_reports/scan-report.json
  --duplicate-strategy <strategy>     manual, prefer-oldest, or prefer-newest. Default: prefer-oldest
  --help                              Show this help.
`);
}

function requireValue(option, value) {
  if (!value || value.startsWith('--')) throw new Error(`${option} には値が必要です`);
  return value;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help') {
      options.help = true;
    } else if (arg === '--videos-dir') {
      options.videosDir = requireValue(arg, next);
      index += 1;
    } else if (arg === '--out') {
      options.manifestPath = requireValue(arg, next);
      index += 1;
    } else if (arg === '--report') {
      options.reportPath = requireValue(arg, next);
      index += 1;
    } else if (arg === '--duplicate-strategy') {
      options.duplicateStrategy = requireValue(arg, next);
      index += 1;
    } else {
      throw new Error(`不明なオプションです: ${arg}`);
    }
  }
  return options;
}

function validateOptions(options) {
  if (options.help) return;
  if (!fs.existsSync(options.videosDir)) throw new Error(`動画フォルダが見つかりません: ${options.videosDir}`);
  normalizeDuplicateStrategy(options.duplicateStrategy);
}

export function main() {
  const cliOptions = parseArgs(process.argv.slice(2));
  if (cliOptions.help) {
    printUsage();
    return;
  }
  const options = resolveLibraryOptions(cliOptions);
  validateOptions(options);

  let result;
  try {
    result = buildVideoManifest({
      videosDir: options.videosDir,
      duplicateStrategy: options.duplicateStrategy,
    });
  } catch (error) {
    if (error?.report) {
      writeJson(options.reportPath, error.report);
      console.error(`report: ${options.reportPath}`);
      printReportSummary(error.report);
    }
    if (error instanceof Error) console.error(error.message);
    throw error;
  }

  writeJson(options.manifestPath, result.manifest);
  writeJson(options.reportPath, result.report);

  console.log(`動画 manifest を生成しました: ${options.manifestPath}`);
  console.log(`動画数: ${result.manifest.videos.length}`);
  console.log(`report: ${options.reportPath}`);
  printReportSummary(result.report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    if (error instanceof Error) {
      if (!error.report) console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  }
}
