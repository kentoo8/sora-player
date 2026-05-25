import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  getErrorMessage,
  isPathInsideDirectory,
  resolveRuntimeLibraryOptions,
} from '../../../lib/api-file-helpers.mjs';

export const runtime = 'nodejs';

type LibraryModule = {
  buildVideoManifest: (options: { videosDir: string; duplicateStrategy: string }) => {
    manifest: { videos: LibraryVideo[] };
    report: unknown;
  };
  resolveLibraryOptions: (options?: { cwd?: string }) => {
    videosDir: string;
    manifestPath: string;
    reportPath: string;
    duplicateStrategy: string;
  };
  readVideoManifestWithExistingFiles: (manifestPath: string, videosDir?: string) => {
    videos: LibraryVideo[];
    report: unknown;
    videosDir: string;
  };
  scanVideoLibrary: (options: { videosDir: string; duplicateStrategy: string }) => {
    videos: LibraryVideo[];
    report: unknown;
  };
  printReportSummary: (report: unknown) => void;
  writeJson: (filePath: string, value: unknown) => void;
};

type LibraryVideo = {
  id: string;
  filename?: string;
  videoPath: string;
  thumbnailPath?: string;
  title?: string;
  prompt?: string;
  createdAt?: string;
  fullPath?: string;
};

async function loadLibrary(): Promise<LibraryModule> {
  return import('../../../lib/video-library.mjs') as unknown as Promise<LibraryModule>;
}

function encodeVideoUrl(videoPath: string) {
  return `/videos/${videoPath.split('/').map(encodeURIComponent).join('/')}`;
}

function toTimestamp(createdAt?: string) {
  if (!createdAt) return 0;
  const time = Date.parse(createdAt);
  return Number.isFinite(time) ? time : 0;
}

function toApiVideo(video: LibraryVideo, videosDir: string) {
  const thumbnailPath = video.thumbnailPath || `_thumbnails/${video.id}.webp`;
  const absoluteThumbnailPath = path.resolve(videosDir, thumbnailPath);
  const thumbnail = fs.existsSync(absoluteThumbnailPath) ? encodeVideoUrl(thumbnailPath) : undefined;
  return {
    id: video.id,
    filename: video.id,
    videoPath: video.videoPath,
    url: encodeVideoUrl(video.videoPath),
    timestamp: toTimestamp(video.createdAt),
    title: video.title || '',
    prompt: video.prompt || '',
    account: undefined,
    thumbnail,
  };
}

function autoManifestDuplicateStrategy(duplicateStrategy: string) {
  return duplicateStrategy === 'manual' ? 'prefer-oldest' : duplicateStrategy;
}

function revealFileInSystem(filePath: string) {
  const dirPath = path.dirname(filePath);
  if (process.platform === 'darwin') {
    execFile('open', ['-R', filePath]);
  } else if (process.platform === 'win32') {
    execFile('explorer', [`/select,${filePath}`]);
  } else {
    execFile('xdg-open', [dirPath]);
  }
}

export async function GET() {
  try {
    const library = await loadLibrary();
    const options = library.resolveLibraryOptions({ cwd: process.cwd() });
    const runtimeOptions = resolveRuntimeLibraryOptions(options);

    if (!runtimeOptions) {
      return NextResponse.json({
        error: 'DIRECTORY_NOT_CONFIGURED',
        message: '動画フォルダが見つかりません。プロジェクト直下に "videos" フォルダを作成するか、config.json の "videosDir" で正しいパスを指定してください。',
      }, { status: 404 });
    }

    let sourceVideos: LibraryVideo[];
    let videosDir = runtimeOptions.videosDir;
    if (fs.existsSync(runtimeOptions.manifestPath)) {
      const result = library.readVideoManifestWithExistingFiles(runtimeOptions.manifestPath, videosDir);
      sourceVideos = result.videos;
      videosDir = result.videosDir;
      library.printReportSummary(result.report);
    } else {
      const duplicateStrategy = autoManifestDuplicateStrategy(runtimeOptions.duplicateStrategy);
      try {
        console.log('[API] 動画 manifest がないため、自動生成します。');
        const result = library.buildVideoManifest({ videosDir, duplicateStrategy });
        library.writeJson(runtimeOptions.manifestPath, result.manifest);
        library.writeJson(runtimeOptions.reportPath, result.report);
        sourceVideos = result.manifest.videos;
        library.printReportSummary(result.report);
      } catch (error) {
        console.error('[API] 動画 manifest の自動生成に失敗したため、一時スキャンで表示します:', error);
        const result = library.scanVideoLibrary({ videosDir, duplicateStrategy });
        sourceVideos = result.videos;
        library.printReportSummary(result.report);
      }
    }

    return NextResponse.json({
      videos: sourceVideos.map((video) => toApiVideo(video, videosDir)),
    });
  } catch (err: unknown) {
    console.error('API Error:', err);
    return NextResponse.json({
      error: 'SERVER_ERROR',
      message: `スキャン中にエラーが発生しました: ${getErrorMessage(err)}`,
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { id, dataUrl } = await request.json();
    if (!id || !dataUrl) {
      return NextResponse.json({ error: 'MISSING_PARAMS' }, { status: 400 });
    }
    if (typeof id !== 'string' || !id.startsWith('gen_') || id.includes('/') || id.includes('..')) {
      return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
    }

    const library = await loadLibrary();
    const options = library.resolveLibraryOptions({ cwd: process.cwd() });
    const runtimeOptions = resolveRuntimeLibraryOptions(options);
    if (!runtimeOptions) {
      return NextResponse.json({ error: 'DIRECTORY_NOT_CONFIGURED' }, { status: 404 });
    }

    const videosDir = runtimeOptions.videosDir;
    const thumbnailsDir = path.join(videosDir, '_thumbnails');
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true });
    }

    const base64Data = dataUrl.replace(/^data:image\/(webp|jpeg);base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filePath = path.join(thumbnailsDir, `${id}.webp`);
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({ success: true, path: filePath });
  } catch (err: unknown) {
    console.error('Thumbnail Save Error:', err);
    return NextResponse.json({ error: 'SAVE_FAILED', message: getErrorMessage(err) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 });

    const library = await loadLibrary();
    const options = library.resolveLibraryOptions({ cwd: process.cwd() });
    const runtimeOptions = resolveRuntimeLibraryOptions(options);
    if (!runtimeOptions) {
      return NextResponse.json({ error: 'DIRECTORY_NOT_CONFIGURED' }, { status: 404 });
    }

    const source = fs.existsSync(runtimeOptions.manifestPath)
      ? library.readVideoManifestWithExistingFiles(runtimeOptions.manifestPath, runtimeOptions.videosDir).videos.find((video) => video.id === id)
      : library.scanVideoLibrary({
        videosDir: runtimeOptions.videosDir,
        duplicateStrategy: autoManifestDuplicateStrategy(runtimeOptions.duplicateStrategy),
      }).videos.find((video) => video.id === id);

    if (!source) {
      return NextResponse.json({ error: 'FILE_NOT_FOUND', id }, { status: 404 });
    }

    const fullPath = path.resolve(source.fullPath || path.resolve(runtimeOptions.videosDir, source.videoPath));
    if (!isPathInsideDirectory(fullPath, runtimeOptions.videosDir)) {
      return NextResponse.json({ error: 'INVALID_PATH' }, { status: 400 });
    }
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'FILE_NOT_FOUND', path: fullPath }, { status: 404 });
    }

    revealFileInSystem(fullPath);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: 'SERVER_ERROR', message: getErrorMessage(err) }, { status: 500 });
  }
}
