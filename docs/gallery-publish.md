# sora-gallery 公開手順

`sora-player` で管理しているローカル動画から、`sora-gallery` の `public/videos.json` と R2 アップロード用ファイルを作る手順です。

公開内容を更新するときは **同期計画作成 → R2 反映 → sora-gallery 反映** の順に進めます。

## 事前準備

1. リポジトリ直下の `videos/` 以外に動画アーカイブを置く場合だけ、`config.json.example` を参考に `config.json` を用意し、`videosDir` を設定します。

2. `data/gallery-export-config.example.json` を参考に、`data/gallery-export-config.json` を用意します。

   通常タグでまとめて公開候補に含めたい場合は `includeTags`、除外したい場合は `excludeTags` に追加します。

   ```json
   "includeTags": ["meta:public", "風景"],
   "excludeTags": ["meta:no-public", "確認中"]
   ```

3. 個別に調整したい動画には、player 上で公開制御用のタグを付けます。

   - `meta:public`: 公開候補に含めます。
   - `meta:no-public`: 公開候補から除外します。

   `meta:` で始まるタグは sora-gallery に表示するタグには含まれません。

## 公開内容を更新

すでに公開中の gallery に動画を追加・削除したり、タグや prompt を更新したりする場合の手順です。

1. 現在公開中の `sora-gallery/public/videos.json` と比較し、反映用ファイルを生成します。

   ```bash
   npm run plan:gallery-sync -- \
     --config data/gallery-export-config.json \
     --previous ../sora-gallery/public/videos.json \
     --fix-thumbnails
   ```

   出力先は OS の一時ディレクトリです。同じコマンドを繰り返し実行できます。

2. 追加する動画とサムネイルを R2 にアップロードします。

   ```bash
   export OUTPUT="$(node -p "require('node:path').join(require('node:os').tmpdir(), 'sora-player-gallery-sync')")"
   rclone copy -P "$OUTPUT/videos" r2:sora-gallery-media/videos
   rclone copy -P "$OUTPUT/thumbnails" r2:sora-gallery-media/thumbnails
   ```

3. 同期計画の結果が `Delete: 1` 以上の場合は、削除対象を確認してから R2 へ反映します。`Delete: 0` の場合はこの手順を飛ばします。

   ```bash
   npm run delete:gallery-objects
   npm run delete:gallery-objects -- --apply
   ```

   1行目で削除対象を確認し、問題がなければ2行目で削除します。

4. R2 全体のファイル数と容量を確認します。

   ```bash
   rclone size r2:sora-gallery-media
   ```

5. 公開 JSON を `sora-gallery` へ反映し、検証・デプロイします。

   ```bash
   cp "$OUTPUT/videos.json" ../sora-gallery/public/videos.json
   cd ../sora-gallery
   npm run validate:remote
   npm run build
   npx wrangler pages deploy dist --project-name sora-gallery
   ```

## 初めて公開

まだ gallery を公開していない場合の手順です。

1. 初回アップロード用ファイルを生成します。

   ```bash
   npm run prepare:gallery-upload -- \
     --config data/gallery-export-config.json
   ```

2. 動画とサムネイルを R2 にアップロードします。

   ```bash
   export OUTPUT="$(node -p "require('node:path').join(require('node:os').tmpdir(), 'sora-player-gallery-upload')")"
   rclone copy -P "$OUTPUT/videos" r2:sora-gallery-media/videos
   rclone copy -P "$OUTPUT/thumbnails" r2:sora-gallery-media/thumbnails
   ```

3. R2 全体のファイル数と容量を確認します。

   ```bash
   rclone size r2:sora-gallery-media
   ```

4. 公開 JSON を `sora-gallery` へ反映し、検証・デプロイします。

   ```bash
   cp "$OUTPUT/videos.json" ../sora-gallery/public/videos.json
   cd ../sora-gallery
   npm run validate:remote
   npm run build
   npx wrangler pages deploy dist --project-name sora-gallery
   ```

## JSON だけ確認する

R2 へのコピーを作らず、公開 JSON の内容だけ確認する場合は `export:gallery` を使います。

```bash
npm run export:gallery -- \
  --config data/gallery-export-config.json \
  --out ../sora-gallery/public/videos.json \
  --dry-run
```

`--dry-run` を外すと `videos.json` と `data/gallery-export-manifest.json` を更新します。

## サムネイル未生成の対応

公開候補にサムネイルがない場合、export / prepare はエラーになります。次のコマンドでまとめて生成してください。動画 manifest も自動更新され、既存のサムネイルは上書きしません。

```bash
npm run generate:gallery-thumbnails -- --config data/gallery-export-config.json
```

`plan:gallery-sync` では `--fix-thumbnails` を付けると、未生成サムネイルの生成を試してから同期計画を続行できます。

## manifest の役割

この公開フローでは、役割の違う manifest を2つ使います。

| ファイル | 役割 |
| --- | --- |
| `<videosDir>/_metadata/manifest.json` | ローカル動画アーカイブの目録 |
| `data/gallery-export-manifest.json` | ローカル動画 ID と公開 UUID / object key の対応表 |

`public/videos.json` の `id` と URL は公開 UUID ベースです。`gen_xxx`、ローカルパス、ローカルアカウント名は出力しません。
