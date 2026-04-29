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
  let videosDir = process.env.VIDEOS_DIR;
  const defaultDir = path.join(process.cwd(), 'videos');
  
  if (!videosDir || !fs.existsSync(videosDir)) {
    if (fs.existsSync(defaultDir)) {
      videosDir = defaultDir;
    } else {
      return NextResponse.json({ 
        error: 'DIRECTORY_NOT_CONFIGURED',
        message: '動画フォルダが見つかりません。プロジェクト直下に "videos" フォルダを作成して動画を入れてください。'
      }, { status: 404 });
    }
  }

  // サムネイルフォルダの作成
  const thumbnailsDir = path.join(videosDir, '_thumbnails');
  if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
  }

  const videos: { 
    id: string, 
    url: string, 
    timestamp: number, 
    title?: string, 
    prompt?: string, 
    account?: string,
    thumbnail?: string // 追記：サムネイルのURL
  }[] = [];

  // ディレクトリを再帰的に走査
  function scanDir(dir: string, accountName?: string) {
    // サムネイルフォルダはスキップ
    if (path.basename(dir) === '_thumbnails') return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    // accountNameが未設定の場合、videosDirの直下であればそれがアカウント名
    const isBaseDir = dir === videosDir;
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
      } catch (e) {
        console.error("Failed to parse generations.json in", dir);
      }
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        let nextAccountName = accountName;
        
        // アカウントディレクトリ直下（第一階層）の場合、account.jsonを探す
        if (isBaseDir) {
          const accountJsonPath = path.join(fullPath, 'account.json');
          if (fs.existsSync(accountJsonPath)) {
            try {
              const accountData = JSON.parse(fs.readFileSync(accountJsonPath, 'utf8'));
              nextAccountName = accountData.name || entry.name;
            } catch (e) {
              console.error(`Failed to parse account.json in ${entry.name}`, e);
              nextAccountName = entry.name;
            }
          } else {
            nextAccountName = entry.name;
          }
        }
        
        scanDir(fullPath, nextAccountName);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
        // パスを /videos/... の相対URLに変換
        const relativePath = path.relative(videosDir!, fullPath);
        const url = `/videos/${relativePath.split(path.sep).join('/')}`;
        
        // IDを一意にするため、相対パスをベースにする
        const id = relativePath.split(path.sep).join('_').replace(/\.mp4$/i, '');
        // メタデータ検索用にはファイル名（ULID）を使用
        const filenameId = entry.name.replace(/\.mp4$/i, '');

        // サムネイルの存在確認（.webp を優先し、なければ .jpg を探す）
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

        // メタデータからの抽出を試みる
        const meta = metadataMap.get(filenameId);
        if (meta) {
          title = meta.title || '';
          prompt = meta.prompt || '';
          
          if (meta.task_id && meta.task_id.startsWith('task_')) {
            const ulid = meta.task_id.replace('task_', '');
            timestamp = decodeTime(ulid);
          }
        }

        // メタデータから取れない場合、ファイル名自体がULIDを持っているか試す (例: gen_01kks...)
        if (timestamp === 0 && id.startsWith('gen_')) {
          const ulidPart = id.replace('gen_', '');
          if (ulidPart.length === 26) {
            timestamp = decodeTime(ulidPart);
          }
        }

        // どうしても取れない場合はファイルの作成日時をフォールバックとして使う
        if (timestamp === 0) {
          try {
            const stat = fs.statSync(fullPath);
            timestamp = stat.mtimeMs;
          } catch (e) {
            console.error(`Failed to stat ${fullPath}`, e);
            timestamp = 0; // 最古として扱う
          }
        }

        // 重複チェック（既に同じファイル名がリストにある場合は追加しない）
        const isDuplicate = videos.some(v => v.url.endsWith(entry.name));
        if (!isDuplicate) {
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
    if (!videosDir) {
      throw new Error('videosDir is undefined');
    }
    scanDir(videosDir);
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

    let videosDir = process.env.VIDEOS_DIR;
    const defaultDir = path.join(process.cwd(), 'videos');
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
