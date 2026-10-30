# YouTube Transcripter

把 YouTube 影片的語音轉成繁體中文逐字稿。適用於沒有字幕的影片：下載音軌後，在本機用 Whisper 做語音辨識。

## Setup

```sh
brew install yt-dlp uv                        # yt-dlp 2026.10.26, uv 0.13.6
uv tool install --python 3.12 mlx-whisper     # Apple Silicon 專用
bun install
```

第一次執行會下載 `mlx-community/whisper-large-v3-turbo` 模型（約 1.6 GB）。

## Usage

```sh
bun transcribe "https://www.youtube.com/watch?v=Vv1_CgeDhoc"   # 轉成逐字稿，缺音訊時自動下載
bun download "<網址>"                                          # 只下載音訊，晚點再轉
bun ls                                                         # 列出全部紀錄，新的在前
bun ls alpha basic                                             # 搜尋標題：多個關鍵字須全部符合，簡繁互通
bun ls "<網址>"                                                 # 用網址或 videoId 精確查詢
bun delete Vv1_CgeDhoc                                         # 確認後把整個資料夾移到垃圾桶
```

- 網址一定要加引號：zsh 會把 `?` 當成 glob，沒加引號會出現 `no matches found`
- `transcribe`、`download`、`delete` 都接受網址或 videoId
- 指令不叫 `bun list`、`bun rm`：這兩個是 Bun 內建指令（列出套件、移除套件），會蓋掉同名 script

每支影片的檔案放在 `output/<videoId>/`：

| 檔案 | 內容 |
| --- | --- |
| `meta.json` | 標題、網址、長度、建立時間 |
| `audio.m4a` | 音訊快取，重跑時跳過下載 |
| `whisper.json` | 辨識結果快取，刪掉才會重新辨識 |
| `transcript.txt` | 逐字稿，每段約 60 秒，開頭標 `[hh:mm:ss]` |

## Pipeline

1. `yt-dlp` 取得標題、長度，只下載音軌
2. `mlx_whisper` 以 `--language zh` 辨識，關閉 `--condition-on-previous-text` 避免一段出錯後一路重複
3. `transcript.ts`（純函數）：OpenCC `cn → twp` 轉台灣繁體、移除連續重複句、合併成段落

## Test

```sh
bun test
bun check
```
