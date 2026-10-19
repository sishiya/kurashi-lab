# kurashi-lab（くらしラボ）

仕事や普段の生活に役立つ、ブラウザで動くツールのシリーズ。Claude（Claude Code）と一緒に作っています。
答えだけでなく「なぜそうなるか」が見えること、入力したものを外に送らないことを大事にしています。

姉妹サイト: [まなびラボ](https://sishiya.github.io/manabi-lab/)（学習用のアプリ）・[あそびラボ](https://sishiya.github.io/asobi-lab/)（ゲーム）

| フォルダ | ツール |
|---|---|
| `my-room/` | わが家の模型（試作。保管庫 `archive.html` に置いています）: 間取りの画像をなぞって部屋の模型を作り、3D で見る。WiFi の置き場所も（電波の計算はまなびラボの「電波の見える部屋」から写したもの） |

- **公開中**: https://sishiya.github.io/kurashi-lab/ （GitHub Pages）。作りかけのツールは保管庫 https://sishiya.github.io/kurashi-lab/archive.html
- サムネイルは `thumbs/<フォルダ名>.jpg`（640×360）

## はじめてクローンしたとき

```
git config core.hooksPath .githooks
git config core.quotepath false
```

1行目で、コミットの前に公開前チェック（`tools/check-public.ps1`）が自動で走ります。

## ライセンス

- プログラムの仕組み: MIT（`LICENSE`）
- ツールの中身（名前・文章・デザイン・画像・文書）: CC BY-NC 4.0（`LICENSE-CONTENT`）
- 読みこむライブラリ（`lib/`）: three.js r128（MIT、`lib/three@0.128.0/LICENSE`）— わが家の模型の 3D
