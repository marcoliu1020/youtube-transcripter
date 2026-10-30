import { existsSync } from "node:fs";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { formatDeleteSummary, formatHistory, parseMeta, parseQuery, searchHistory, type HistoryRecord, type StoredMeta } from "./history.ts";
import { buildTranscript, parseVideoId, parseWhisperJson, type Segment } from "./transcript.ts";
import { formatTimestamp } from "./utils.ts";

// ===== Usage =====
// bun ls [網址｜videoId｜關鍵字…]   列出或搜尋歷史紀錄
// bun download <網址｜videoId>       只下載音訊
// bun transcribe <網址｜videoId>     轉成逐字稿（缺音訊時自動下載）
// bun delete <網址｜videoId>         確認後把整支影片的資料夾移到垃圾桶
// 每支影片的檔案放在 output/<videoId>/；已完成的步驟會快取，重跑時跳過

const OUTPUT_DIR = "output";
const WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";
const INITIAL_PROMPT = "以下是一堂繁體中文課程的逐字稿，內容包含標點符號。";

const [command, ...args] = process.argv.slice(2);
await runCommand(command, args).catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

// ===== Main Flow =====

async function runCommand(command: string | undefined, args: string[]): Promise<void> {
  switch (command) {
    case "ls":
      return listHistory(args);
    case "download":
      return download(args);
    case "transcribe":
      return transcribe(args);
    case "delete":
      return deleteVideo(args);
    default:
      throw new Error(`未知的指令「${command ?? ""}」，可用指令：ls、download、transcribe、delete`);
  }
}

async function listHistory(args: string[]): Promise<void> {
  const query = parseQuery(args);
  console.log(formatHistory(searchHistory(await readHistory(), query), query));
}

async function download(args: string[]): Promise<void> {
  const videoId = requireVideoId(args, "download");
  await ensureMeta(videoId);
  console.log(`✓ 音訊：${await ensureAudio(videoId)}`);
}

async function transcribe(args: string[]): Promise<void> {
  const videoId = requireVideoId(args, "transcribe");
  const meta = await ensureMeta(videoId);
  const segments = await ensureSegments(videoId, await ensureAudio(videoId));

  const outputPath = join(videoDir(videoId), "transcript.txt");
  await Bun.write(outputPath, buildTranscript(meta, segments));
  console.log(`✓ 逐字稿：${outputPath}`);
}

async function deleteVideo(args: string[]): Promise<void> {
  const videoId = requireVideoId(args, "delete");
  const record = await readRecord(videoId);
  if (!record) throw new Error(`找不到 ${videoId} 的紀錄（bun ls 可查看全部）`);

  console.log(formatDeleteSummary(record, await directorySize(record.dir)));
  if (prompt("確定要移到垃圾桶？(y/N)")?.trim().toLowerCase() !== "y") {
    console.log("已取消");
    return;
  }
  await run(["/usr/bin/trash", record.dir], "inherit");
  console.log(`✓ 已移到垃圾桶：${record.dir}`);
}

// ===== Sub Functions =====

async function readHistory(): Promise<HistoryRecord[]> {
  if (!existsSync(OUTPUT_DIR)) return [];
  const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
  const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readRecord(entry.name)));
  return records.filter((record) => record !== undefined);
}

function requireVideoId(args: string[], command: string): string {
  const parsed = parseVideoId(args[0] ?? "");
  if (parsed.kind === "invalid") throw new Error(`無法辨識的 YouTube 網址或 videoId：「${parsed.input}」\n用法：bun ${command} "<網址>"`);
  return parsed.videoId;
}

async function ensureMeta(videoId: string): Promise<StoredMeta> {
  const metaPath = join(videoDir(videoId), "meta.json");
  const cached = existsSync(metaPath) ? parseMeta(await Bun.file(metaPath).text()) : undefined;
  const meta = cached ?? { ...(await fetchMeta(videoId)), createdAt: new Date().toISOString() };
  if (!cached) {
    await mkdir(videoDir(videoId), { recursive: true });
    await Bun.write(metaPath, JSON.stringify(meta, null, 2));
  }

  console.log(`▶ ${meta.title}（${formatTimestamp(meta.durationSeconds)}）`);
  return meta;
}

// 先下載成 audio.download.m4a，成功才改名：中途中斷不會留下被當成快取的半成品
async function ensureAudio(videoId: string): Promise<string> {
  const audioPath = join(videoDir(videoId), "audio.m4a");
  if (existsSync(audioPath)) {
    console.log(`↺ 使用已下載的音訊：${audioPath}`);
    return audioPath;
  }
  console.log("⇣ 下載音訊…");
  const tempTemplate = join(videoDir(videoId), "audio.download.%(ext)s");
  await run(["yt-dlp", "-f", "bestaudio", "-x", "--audio-format", "m4a", "-o", tempTemplate, videoUrl(videoId)], "inherit");
  await rename(join(videoDir(videoId), "audio.download.m4a"), audioPath);
  return audioPath;
}

async function ensureSegments(videoId: string, audioPath: string): Promise<Segment[]> {
  const whisperPath = join(videoDir(videoId), "whisper.json");
  if (existsSync(whisperPath)) {
    console.log(`↺ 使用已完成的辨識結果：${whisperPath}`);
  } else {
    console.log(`🎙 語音辨識中（${WHISPER_MODEL}）…`);
    // 關閉 condition-on-previous-text：開著的話，一段辨識錯誤會一路傳下去，曾讓 7 分鐘的內容變成「那,那,那…」
    await run(
      ["mlx_whisper", audioPath, "--model", WHISPER_MODEL, "--language", "zh", "--initial-prompt", INITIAL_PROMPT,
        "--condition-on-previous-text", "False", "--output-format", "json", "--output-dir", videoDir(videoId),
        "--output-name", "whisper", "--verbose", "False"],
      "inherit",
    );
  }
  const parsed = parseWhisperJson(await Bun.file(whisperPath).text());
  if (parsed.kind === "invalid") throw new Error(`${parsed.reason}（刪掉 ${whisperPath} 可重新辨識）`);
  return parsed.segments;
}

async function readRecord(videoId: string): Promise<HistoryRecord | undefined> {
  const dir = videoDir(videoId);
  if (!existsSync(dir)) return undefined;
  const files = (await readdir(dir)).filter((file) => !file.startsWith("."));
  const meta = files.includes("meta.json") ? parseMeta(await Bun.file(join(dir, "meta.json")).text()) : undefined;
  return { videoId, dir, meta, files };
}

async function fetchMeta(videoId: string): Promise<Omit<StoredMeta, "createdAt">> {
  const url = videoUrl(videoId);
  const stdout = await run(["yt-dlp", "--skip-download", "--print", "%(title)s\n%(duration)s", url], "pipe");
  const [title = "", duration = ""] = stdout.trim().split("\n");
  const durationSeconds = Number(duration);
  if (!title || Number.isNaN(durationSeconds)) throw new Error(`yt-dlp 回傳的影片資訊無法解析：${stdout}`);
  return { title, url, durationSeconds };
}

function videoDir(videoId: string): string {
  return join(OUTPUT_DIR, videoId);
}

function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ===== Utilities =====

async function directorySize(dir: string): Promise<number> {
  const sizes = await Promise.all((await readdir(dir)).map(async (file) => (await stat(join(dir, file))).size));
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function run(cmd: string[], stdout: "pipe" | "inherit"): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout, stderr: "inherit" });
  const output = stdout === "pipe" ? await new Response(proc.stdout).text() : "";
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`${cmd[0]} 失敗（exit ${exitCode}）`);
  return output;
}
