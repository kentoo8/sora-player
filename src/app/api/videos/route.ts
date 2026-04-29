import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// ULIDの最初の10文字からタイムスタンプをデコードする関数
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;

function decodeTime(id: string): number {
  if (id.length !== 26) return 0;
  try {
    const time = id
      .substring(0, 10)
      .split("")
      .reduce((carry, char) => {
        const encodingIndex = ENCODING.indexOf(char.toUpperCase());
        if (encodingIndex === -1) throw new Error("Invalid char");
        return carry * ENCODING_LEN + encodingIndex;
      }, 0);
    return time;
  } catch (e) {
    return 0;
  }
}

export async function GET() {
  const configPath = path.join(process.cwd(), 'config.json');
  let config: any = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {}
  }

  let videosDir = config.videosDir || process.env.VIDEOS_DIR;
  const defaultDir = path.join(process.cwd(), 'videos');

  // 相対パスの場合は絶対パスに変換
  if (videosDir && !path.isAbsolute(videosDir)) {
    videosDir = path.resolve(process.cwd(), videosDir);
  }
  
  if (!videosDir || !fs.existsSync(videosDir)) {
    if (fs.existsSync(defaultDir)) {
      videosDir = defaultDir;
    } else {
      return NextResponse.json({ 
        error: 'DIRECTORY_NOT_CONFIGURED',
        message: '動画フォルダが見つかりません。プロジェクト直下の "videos" フォルダを作成するか、config.json でパスを指定してください。'
      }, { status: 404 });
    }
  }

  // パスを絶対パスに正規化
  const absoluteVideosDir = path.resolve(videosDir);
  console.log(`[API] Scanning directory: ${absoluteVideosDir}`);

  // サムネイルフォルダの作成
  const thumbnailsDir = path.join(absoluteVideosDir, '_thumbnails');
  if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
  }

  const videos: any[] = [];

  // ディレクトリを再帰的に走査
  function scanDir(dir: string, accountName?: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    const isBaseDir = dir === absoluteVideosDir;
    let metadataMap = new Map<string, any>();
    const metaPath = path.join(dir, 'generations.json');
    if (fs.existsSync(metaPath)) {
      try {
        const metaContent = fs.readFileSync(metaPath, 'utf8');
        const metaJson = JSON.parse(metaContent);
        if (Array.isArray(metaJson)) {
          metaJson.forEach(item => {
            if (item.id) metadataMap.set(item.id, item);
          });
        }
      } catch (e) {}
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // サムネイルフォルダはスキップ
        if (entry.name === '_thumbnails') continue;

        let nextAccountName = accountName;
        if (isBaseDir) {
          const accountJsonPath = path.join(fullPath, 'account.json');
          if (fs.existsSync(accountJsonPath)) {
            try {
              const accountData = JSON.parse(fs.readFileSync(accountJsonPath, 'utf8'));
              nextAccountName = accountData.name || entry.name;
            } catch (e) {
              nextAccountName = entry.name;
            }
          } else {
            nextAccountName = entry.name;
          }
        }
        scanDir(fullPath, nextAccountName);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
        const relativePath = path.relative(absoluteVideosDir, fullPath);
        const url = `/videos/${relativePath.split(path.sep).join('/')}`;
        const id = relativePath.split(path.sep).join('@@').replace(/\.mp4$/i, '');
        const filenameId = entry.name.replace(/\.mp4$/i, '');

        const thumbFilenameWebp = `${id}.webp`;
        const thumbFilenameJpg = `${id}.jpg`;
        const thumbPathWebp = path.join(thumbnailsDir, thumbFilenameWebp);
        const thumbPathJpg = path.join(thumbnailsDir, thumbFilenameJpg);
        
        let thumbUrl = undefined;
        if (fs.existsSync(thumbPathWebp)) {
          thumbUrl = `/videos/_thumbnails/${thumbFilenameWebp}`;
        } else if (fs.existsSync(thumbPathJpg)) {
          thumbUrl = `/videos/_thumbnails/${thumbFilenameJpg}`;
        }

        let timestamp = 0;
        let title = '';
        let prompt = '';

        const meta = metadataMap.get(filenameId);
        if (meta) {
          title = meta.title || '';
          prompt = meta.prompt || '';
          if (meta.task_id && meta.task_id.startsWith('task_')) {
            timestamp = decodeTime(meta.task_id.replace('task_', ''));
          }
        }

        if (timestamp === 0 && filenameId.startsWith('gen_')) {
          const ulidPart = filenameId.replace('gen_', '');
          if (ulidPart.length === 26) timestamp = decodeTime(ulidPart);
        }

        if (timestamp === 0) {
          try {
            timestamp = fs.statSync(fullPath).mtimeMs;
          } catch (e) {}
        }

        // URLで重複チェック
        if (!videos.some(v => v.url === url)) {
          videos.push({
            id,
            filename: filenameId,
            url,
            timestamp,
            title,
            prompt,
            account: accountName,
            thumbnail: thumbUrl
          });
        }
      }
    }
  }

  try {
    scanDir(absoluteVideosDir);
    // 新しい順（降順）にソート
    videos.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    return NextResponse.json({ videos });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ 
      error: 'SERVER_ERROR',
      message: `スキャン中にエラーが発生しました: ${err.message}` 
    }, { status: 500 });
  }
}

// サムネイル保存用の POST ハンドラ
export async function POST(request: Request) {
  try {
    const { id, dataUrl } = await request.json();
    if (!id || !dataUrl) {
      return NextResponse.json({ error: 'MISSING_PARAMS' }, { status: 400 });
    }

    const configPath = path.join(process.cwd(), 'config.json');
    let config: any = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (e) {}
    }

    let videosDir = config.videosDir || process.env.VIDEOS_DIR;
    const defaultDir = path.join(process.cwd(), 'videos');

    // 相対パスの場合は絶対パスに変換
    if (videosDir && !path.isAbsolute(videosDir)) {
      videosDir = path.resolve(process.cwd(), videosDir);
    }

    if (!videosDir || !fs.existsSync(videosDir)) {
      videosDir = defaultDir;
    }

    const thumbnailsDir = path.join(videosDir, '_thumbnails');
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true });
    }

    // data:image/webp;base64,.... をバイナリに変換
    const base64Data = dataUrl.replace(/^data:image\/(webp|jpeg);base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    
    const filePath = path.join(thumbnailsDir, `${id}.webp`);
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({ success: true, path: filePath });
  } catch (err: any) {
    console.error('Thumbnail Save Error:', err);
    return NextResponse.json({ error: 'SAVE_FAILED', message: err.message }, { status: 500 });
  }
}
