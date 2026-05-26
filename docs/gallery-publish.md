# sora-gallery 公開手順

`sora-player` で管理しているローカル動画から、`sora-gallery` の `public/videos.json` と R2 アップロード用ファイルを作る手順です。

通常更新では **動画 manifest 生成 → 同期計画作成 → R2 反映 → sora-gallery 反映** の順に進めます。

## 事前準備

1. `config.json` で動画アーカイブの場所を設定します。

   ```json
   {
     "videosDir": "~/Documents/videos/sora2-data-files",
     "manifestPath": "_metadata/manifest.json",
     "reportPath": "_reports/scan-report.json",
     "duplicateStrategy": "prefer-oldest"
   }
   ```

2. `data/gallery-export-config.example.json` を参考に、`data/gallery-export-config.json` を用意します。

   ```json
   {
     "version": 1,
     "publicBaseUrl": "https://cdn.example.com/sora",
     "includeTags": ["meta:public", "公開したいタグ1", "公開したいタグ2"],
     "excludeTags": ["meta:no-public", "除外したいタグ1", "除外したいタグ2"],
     "privateTagPrefixes": ["meta:"],
     "allowedMetaTags": ["meta:public", "meta:no-public"]
   }
   ```

   `includeTags` に一致するタグを持つ動画だけが公開候補になります。`excludeTags` は公開候補から除外するためのタグです。

3. 公開したい動画に player 上で `meta:public` を付けます。公開したくない動画には `meta:no-public` を付けます。

## 動画 manifest を更新

公開作業の前に、ローカル動画アーカイブの目録を更新します。

```bash
npm run generate:manifest
```

既定では以下を更新します。

- `<videosDir>/_metadata/manifest.json`
- `<videosDir>/_reports/scan-report.json`

同じ `gen_xxx` の動画が複数ある場合、既定では古い動画を採用します。確認しながら止めたい場合や、新しい動画を採用したい場合だけ明示指定します。

```bash
npm run generate:manifest -- --duplicate-strategy manual
npm run generate:manifest -- --duplicate-strategy prefer-newest
```

## 公開候補サムネイルを生成

公開候補のサムネイルは CLI でまとめて生成できます。既存のサムネイルは上書きしません。

```bash
npm run generate:gallery-thumbnails -- --config data/gallery-export-config.json
npm run generate:manifest
```

## 通常更新

前回公開済みの `sora-gallery/public/videos.json` がある場合は、同期計画を作ります。

```bash
npm run plan:gallery-sync -- \
  --config data/gallery-export-config.json \
  --previous ../sora-gallery/public/videos.json \
  --out /private/tmp/sora-gallery-sync \
  --fix-thumbnails
```

出力:

- `videos.json`: 次に `sora-gallery/public/videos.json` へ反映する JSON
- `upload-manifest.json`: R2 へ追加アップロードする動画
- `delete-manifest.json`: R2 から削除する動画
- `changed-metadata.json`: タグや prompt など JSON だけが変わった動画
- `unchanged.json`: 変更なしの動画
- `videos/`, `thumbnails/`: 追加アップロード対象だけをコピーしたディレクトリ

`upload-manifest.json` が空でなければ、追加分を R2 にアップロードします。

```bash
rclone copy /private/tmp/sora-gallery-sync/videos r2:sora-gallery-media/videos
rclone copy /private/tmp/sora-gallery-sync/thumbnails r2:sora-gallery-media/thumbnails
```

`delete-manifest.json` が空でなければ、記載された object key を R2 から削除します。

最後に `/private/tmp/sora-gallery-sync/videos.json` を `sora-gallery/public/videos.json` へ反映し、`sora-gallery` 側で検証・デプロイします。

## 初回公開

前回の `videos.json` がない場合は、アップロード用ディレクトリを作成します。

```bash
npm run prepare:gallery-upload -- \
  --config data/gallery-export-config.json \
  --out /private/tmp/sora-gallery-upload
```

`--out` には空のディレクトリを指定してください。作成後、動画とサムネイルを R2 にアップロードします。

```bash
rclone copy /private/tmp/sora-gallery-upload/videos r2:sora-gallery-media/videos
rclone copy /private/tmp/sora-gallery-upload/thumbnails r2:sora-gallery-media/thumbnails
```

その後、`/private/tmp/sora-gallery-upload/videos.json` を `sora-gallery/public/videos.json` へ反映します。

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

公開候補にサムネイルがない場合、export / prepare / sync はエラーになります。まず次のコマンドでまとめて生成してください。

```bash
npm run generate:gallery-thumbnails -- --config data/gallery-export-config.json
npm run generate:manifest
```

`plan:gallery-sync` では `--fix-thumbnails` を付けると、未生成サムネイルの生成を試してから同期計画を続行できます。

## manifest の役割

この公開フローでは、役割の違う manifest を2つ使います。

| ファイル | 役割 |
| --- | --- |
| `<videosDir>/_metadata/manifest.json` | ローカル動画アーカイブの目録 |
| `data/gallery-export-manifest.json` | ローカル動画 ID と公開 UUID / object key の対応表 |

`public/videos.json` の `id` と URL は公開 UUID ベースです。`gen_xxx`、ローカルパス、ローカルアカウント名は出力しません。
