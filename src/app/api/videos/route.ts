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
  const videosDir = process.env.VIDEOS_DIR;
  
  if (!videosDir || !fs.existsSync(videosDir)) {
    return NextResponse.json({ error: 'Videos directory not configured or not found' }, { status: 404 });
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
        const id = entry.name.replace(/\.mp4$/i, '');
        
        // パスを /videos/... の相対URLに変換
        const relativePath = path.relative(videosDir, fullPath);
        const url = `/videos/${relativePath.split(path.sep).join('/')}`;

        let timestamp = 0;
        let title = '';
        let prompt = '';

        // メタデータからの抽出を試みる
        const meta = metadataMap.get(id);
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
          const stat = fs.statSync(fullPath);
          timestamp = stat.mtimeMs;
        }

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

  try {
    scanDir(videosDir);
    // 新しい順（降順）にソート
    videos.sort((a, b) => b.timestamp - a.timestamp);
    
    return NextResponse.json({ videos });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to scan videos' }, { status: 500 });
  }
}
