import { NextResponse } from 'next/server';
import {
  addTagsToVideos,
  getErrorMessage,
  getTagsPaths,
  readTagsFile,
  replaceTagsForVideos,
  writeTagsFile,
} from '../../../lib/tag-library.mjs';

export async function GET() {
  try {
    return NextResponse.json(readTagsFile());
  } catch (err: unknown) {
    return NextResponse.json(
      { error: 'READ_FAILED', message: getErrorMessage(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { filenames, tags } = await request.json();
    const tagsFile = readTagsFile();
    const changed = addTagsToVideos(tagsFile, filenames, tags);
    if (!changed) {
      return NextResponse.json({ error: 'MISSING_PARAMS' }, { status: 400 });
    }

    writeTagsFile(tagsFile, getTagsPaths());

    return NextResponse.json({ success: true, tags: tagsFile.videos });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: 'SAVE_FAILED', message: getErrorMessage(err) },
      { status: 500 }
    );
  }
}

// PUT: タグを上書き設定（追加・除去の両方に対応）
export async function PUT(request: Request) {
  try {
    const { filenames, tags, updates } = await request.json();
    const tagsFile = readTagsFile();
    const changed = replaceTagsForVideos(tagsFile, filenames, tags, updates);
    if (!changed) {
      return NextResponse.json({ error: 'MISSING_PARAMS' }, { status: 400 });
    }

    writeTagsFile(tagsFile, getTagsPaths());

    return NextResponse.json({ success: true, tags: tagsFile.videos });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: 'SAVE_FAILED', message: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
