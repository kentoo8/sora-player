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

すでに公開中の gallery に動画を追加・削除したり、タグや prompt を更新したりする場合は、次のコマンドを実行します。現在公開中の `sora-gallery/public/videos.json` との比較と、同期計画の作成が自動で行われます。

```bash
npm run plan:gallery-sync -- \
  --config data/gallery-export-config.json \
  --previous ../sora-gallery/public/videos.json \
  --fix-thumbnails
```

出力先は OS の一時ディレクトリです。同じコマンドを繰り返し実行できます。追加する動画とサムネイルを R2 にアップロードします。

```bash
OUTPUT="$(node -p "require('node:path').join(require('node:os').tmpdir(), 'sora-player-gallery-sync')")"
rclone copy "$OUTPUT/videos" r2:sora-gallery-media/videos
rclone copy "$OUTPUT/thumbnails" r2:sora-gallery-media/thumbnails
```

動画を削除した場合は、`$OUTPUT/delete-manifest.json` に記載された object key を R2 から削除します。

最後に `$OUTPUT/videos.json` を `sora-gallery/public/videos.json` へ反映し、`sora-gallery` 側で検証・デプロイします。

## 初めて公開

まだ gallery を公開していない場合は、初回アップロード用ディレクトリを作成します。

```bash
npm run prepare:gallery-upload -- \
  --config data/gallery-export-config.json
```

動画とサムネイルを R2 にアップロードします。

```bash
OUTPUT="$(node -p "require('node:path').join(require('node:os').tmpdir(), 'sora-player-gallery-upload')")"
rclone copy "$OUTPUT/videos" r2:sora-gallery-media/videos
rclone copy "$OUTPUT/thumbnails" r2:sora-gallery-media/thumbnails
```

その後、`$OUTPUT/videos.json` を `sora-gallery/public/videos.json` へ反映します。

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
