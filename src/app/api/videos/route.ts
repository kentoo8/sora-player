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

  const videos: { id: string, url: string, timestamp: number, title?: string, prompt?: string, account?: string }[] = [];

  // ディレクトリを再帰的に走査
  function scanDir(dir: string, accountName?: string) {
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
        const relativePath = path.relative(videosDir, fullPath);
        const url = `/videos/${relativePath.split(path.sep).join('/')}`;
        
        // IDを一意にするため、相対パスをベースにする
        const id = relativePath.split(path.sep).join('_').replace(/\.mp4$/i, '');
        // メタデータ検索用にはファイル名（ULID）を使用
        const filenameId = entry.name.replace(/\.mp4$/i, '');

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
            url,
            timestamp,
            title,
            prompt,
            account: accountName
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
