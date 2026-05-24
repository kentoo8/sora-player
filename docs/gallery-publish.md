# sora-gallery 公開手順

このドキュメントは `sora-player` で管理しているローカル動画を、`sora-gallery` の `public/videos.json` と R2 アップロード用ファイルへ変換する手順です。

## 2つの manifest

`sora-player` には役割の違う manifest が2つあります。

| ファイル | 役割 | 主キー |
| --- | --- | --- |
| `<videosDir>/_metadata/manifest.json` | ローカル動画アーカイブの正規化済み目録 | `gen_xxx` |
| `data/gallery-export-manifest.json` | `gen_xxx` と公開 UUID / object key の対応表 | `gen_xxx` |

動画 manifest は、動画ファイルの所在、サムネイル、`generations.json` 由来の `prompt` / `createdAt` などを持ちます。

gallery export manifest は、公開 URL を安定させるための対応表です。`public/videos.json` の `id` と URL は公開 UUID ベースで、ローカル ID やローカルパスは出力しません。

## 事前準備

`config.json` に動画アーカイブを設定します。`config.json` は Git 管理外です。

```json
{
  "videosDir": "~/Documents/videos/sora2-data-files",
  "manifestPath": "_metadata/manifest.json",
  "reportPath": "_reports/scan-report.json",
  "duplicateStrategy": "manual"
}
```

相対の `manifestPath` と `reportPath` は `videosDir` 基準です。

## 動画 manifest を生成

```bash
npm run generate:manifest
```

既定では以下を上書きします。

- `<videosDir>/_metadata/manifest.json`
- `<videosDir>/_reports/scan-report.json`

`duplicateStrategy` の既定は `manual` です。同じ `gen_xxx` の動画が複数ある場合は処理を止め、日本語のガイドと候補パスを出します。自動解決する場合は次のように再実行します。

```bash
npm run generate:manifest -- --duplicate-strategy prefer-oldest
npm run generate:manifest -- --duplicate-strategy prefer-newest
```

警告だけなら manifest は生成されます。たとえば `generations.json` に対応する動画がない、`gen_` 以外の動画がある、サムネイルが未生成、などは `_reports/scan-report.json` に残ります。

## サムネイル

player ではサムネイルがない動画も表示されます。動画を閲覧しているうちに `_thumbnails/gen_xxx.webp` が生成されます。

gallery export / prepare / sync では、公開候補にサムネイルがない場合はエラーになります。エラーに表示された ID を player で開き、サムネイル生成後に再実行してください。

## 公開 JSON を生成

`sora-gallery` に渡す `public/videos.json` は、動画 manifest とタグから生成します。誤公開を避けるため、公開対象にするタグは `data/gallery-export-config.json` の `includeTags` で指定します。

```bash
npm run export:gallery -- \
  --config data/gallery-export-config.json \
  --out ../sora-gallery/public/videos.json
```

`public/videos.json` には `id`, `videoUrl`, `thumbnailUrl`, `prompt`, `tags`, `createdAt` と、空でない場合のみ `description` が含まれます。`id` は公開 UUID です。`gen_xxx`、ローカルパス、相対パス、ローカルアカウント名は含めません。

確認だけ行う場合は `--dry-run` を付けます。

## アップロード用ディレクトリを作成

R2 へアップロードする前に、公開 UUID のファイル名へ揃えた一時ディレクトリを作成します。

```bash
npm run prepare:gallery-upload -- \
  --config data/gallery-export-config.json \
  --out /private/tmp/sora-gallery-upload-prod
```

`--out` には空のディレクトリを指定してください。

作成後は `rclone` で `videos/` と `thumbnails/` を R2 にコピーします。

```bash
rclone copy /private/tmp/sora-gallery-upload-prod/videos r2:sora-gallery-media/videos
rclone copy /private/tmp/sora-gallery-upload-prod/thumbnails r2:sora-gallery-media/thumbnails
```

## 更新差分を作成

前回公開済みの `sora-gallery/public/videos.json` と次回 export 結果を比較して、追加・削除・JSONのみ変更を分けた同期計画を作成できます。

```bash
npm run plan:gallery-sync -- \
  --config data/gallery-export-config.json \
  --previous ../sora-gallery/public/videos.json \
  --out /private/tmp/sora-gallery-sync
```

出力:

- `videos.json`: 次回公開する `public/videos.json`
- `upload-manifest.json`: R2 へ追加アップロードする動画
- `delete-manifest.json`: R2 から削除する動画
- `changed-metadata.json`: タグや prompt など JSON だけが変わった動画
- `unchanged.json`: 変更なしの動画
- `videos/`, `thumbnails/`: 追加アップロード対象だけをコピーしたディレクトリ

`upload-manifest.json` が空でなければ `videos/` と `thumbnails/` を R2 にアップロードします。`delete-manifest.json` が空でなければ、対象 object を R2 から削除します。`changed-metadata.json` だけが変わっている場合は R2 を触らず、`videos.json` の更新と `sora-gallery` 側の検証・デプロイだけを行います。
