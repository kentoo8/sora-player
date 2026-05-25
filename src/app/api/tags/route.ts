import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

type TagsFile = {
  version: number;
  videos: Record<string, string[]>;
};

const dataDir = path.join(process.cwd(), 'data');
const tagsPath = path.join(dataDir, 'tags.json');

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];

  return Array.from(
    new Set(
      tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map(tag => tag.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'ja'));
}

function readTagsFile(): TagsFile {
  if (!fs.existsSync(tagsPath)) {
    return { version: 1, videos: {} };
  }

  const parsed = JSON.parse(fs.readFileSync(tagsPath, 'utf8'));
  const videos = parsed && typeof parsed.videos === 'object' && parsed.videos !== null
    ? parsed.videos
    : {};

  return {
    version: 1,
    videos: Object.fromEntries(
      Object.entries(videos)
        .filter(([filename]) => filename)
        .map(([filename, tags]) => [filename, normalizeTags(tags)])
        .filter(([, tags]) => tags.length > 0)
    )
  };
}

function writeTagsFile(tagsFile: TagsFile) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(tagsPath, `${JSON.stringify(tagsFile, null, 2)}\n`);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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
    const targetFilenames = Array.isArray(filenames)
      ? filenames.filter((filename): filename is string => typeof filename === 'string' && filename.trim().length > 0)
      : [];
    const nextTags = normalizeTags(tags);

    if (targetFilenames.length === 0 || nextTags.length === 0) {
      return NextResponse.json({ error: 'MISSING_PARAMS' }, { status: 400 });
    }

    const tagsFile = readTagsFile();
    for (const filename of targetFilenames) {
      tagsFile.videos[filename] = normalizeTags([
        ...(tagsFile.videos[filename] || []),
        ...nextTags
      ]);
    }

    writeTagsFile(tagsFile);

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
    const targetFilenames = Array.isArray(filenames)
      ? filenames.filter((filename): filename is string => typeof filename === 'string' && filename.trim().length > 0)
      : [];
    const nextTags = normalizeTags(tags);
    const targetUpdates = Array.isArray(updates)
      ? updates
          .filter((update): update is { filename: string; tags: unknown } => (
            update &&
            typeof update === 'object' &&
            'filename' in update &&
            typeof update.filename === 'string' &&
            update.filename.trim().length > 0
          ))
          .map(update => ({ filename: update.filename, tags: normalizeTags(update.tags) }))
      : [];

    if (targetFilenames.length === 0 && targetUpdates.length === 0) {
      return NextResponse.json({ error: 'MISSING_PARAMS' }, { status: 400 });
    }

    const tagsFile = readTagsFile();
    for (const { filename, tags } of targetUpdates) {
      if (tags.length > 0) {
        tagsFile.videos[filename] = tags;
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

    writeTagsFile(tagsFile);

    return NextResponse.json({ success: true, tags: tagsFile.videos });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: 'SAVE_FAILED', message: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
