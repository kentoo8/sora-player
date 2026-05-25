import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

type LibraryModule = {
  resolveLibraryOptions: (options?: { cwd?: string }) => {
    videosDir: string;
    manifestPath: string;
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

function runtimeScanDuplicateStrategy(duplicateStrategy: string) {
  return duplicateStrategy === 'manual' ? 'prefer-newest' : duplicateStrategy;
}

export async function GET() {
  try {
    const library = await loadLibrary();
    const options = library.resolveLibraryOptions({ cwd: process.cwd() });
    const defaultDir = path.join(process.cwd(), 'videos');
    let videosDir = options.videosDir;

    if (!fs.existsSync(videosDir)) {
      if (fs.existsSync(defaultDir)) {
        videosDir = defaultDir;
      } else {
        return NextResponse.json({
          error: 'DIRECTORY_NOT_CONFIGURED',
          message: '動画フォルダが見つかりません。プロジェクト直下に "videos" フォルダを作成するか、config.json の "videosDir" で正しいパスを指定してください。',
        }, { status: 404 });
      }
    }

    let sourceVideos: LibraryVideo[];
    if (fs.existsSync(options.manifestPath)) {
      const result = library.readVideoManifestWithExistingFiles(options.manifestPath, videosDir);
      sourceVideos = result.videos;
      videosDir = result.videosDir;
      library.printReportSummary(result.report);
    } else {
      console.log('[API] 動画 manifest がないため、一時スキャンで表示します。正式運用では npm run generate:manifest を実行してください。');
      const result = library.scanVideoLibrary({
        videosDir,
        duplicateStrategy: runtimeScanDuplicateStrategy(options.duplicateStrategy),
      });
      sourceVideos = result.videos;
      library.printReportSummary(result.report);
    }

    return NextResponse.json({
      videos: sourceVideos.map((video) => toApiVideo(video, videosDir)),
    });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({
      error: 'SERVER_ERROR',
      message: `スキャン中にエラーが発生しました: ${err.message}`,
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
    const videosDir = fs.existsSync(options.videosDir) ? options.videosDir : path.join(process.cwd(), 'videos');
    const thumbnailsDir = path.join(videosDir, '_thumbnails');
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true });
    }

    const base64Data = dataUrl.replace(/^data:image\/(webp|jpeg);base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filePath = path.join(thumbnailsDir, `${id}.webp`);
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({ success: true, path: filePath });
  } catch (err: any) {
    console.error('Thumbnail Save Error:', err);
    return NextResponse.json({ error: 'SAVE_FAILED', message: err.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 });

    const library = await loadLibrary();
    const options = library.resolveLibraryOptions({ cwd: process.cwd() });
    const source = fs.existsSync(options.manifestPath)
      ? library.readVideoManifestWithExistingFiles(options.manifestPath, options.videosDir).videos.find((video) => video.id === id)
      : library.scanVideoLibrary({
        videosDir: options.videosDir,
        duplicateStrategy: runtimeScanDuplicateStrategy(options.duplicateStrategy),
      }).videos.find((video) => video.id === id);

    if (!source) {
      return NextResponse.json({ error: 'FILE_NOT_FOUND', id }, { status: 404 });
    }

    const fullPath = source.fullPath || path.resolve(options.videosDir, source.videoPath);
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'FILE_NOT_FOUND', path: fullPath }, { status: 404 });
    }

    const { exec } = require('child_process');
    const dirPath = path.dirname(fullPath);
    let command = '';
    if (process.platform === 'darwin') {
      command = `open -R "${fullPath}"`;
    } else if (process.platform === 'win32') {
      command = `explorer /select,"${fullPath}"`;
    } else {
      command = `xdg-open "${dirPath}"`;
    }

    exec(command);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'SERVER_ERROR', message: err.message }, { status: 500 });
  }
}
