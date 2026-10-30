import { parseVideoId, type VideoMeta } from "./transcript.ts";
import { formatTimestamp, toTraditional, tryParseJson } from "./utils.ts";

// ===== Usage =====
// 純核心：歷史紀錄的搜尋、狀態判斷與輸出格式。cli.ts 讀完 output/ 之後交給這裡決定要顯示什麼。

export type StoredMeta = VideoMeta & { createdAt: string };
export type HistoryRecord = { videoId: string; dir: string; meta: StoredMeta | undefined; files: string[] };
export type Query = { kind: "all" } | { kind: "url"; videoId: string } | { kind: "keywords"; keywords: readonly string[] };

export function parseQuery(args: string[]): Query {
  const input = args.join(" ").trim();
  if (input === "") return { kind: "all" };

  const parsed = URL.canParse(input) ? parseVideoId(input) : undefined;
  if (parsed?.kind === "ok") return { kind: "url", videoId: parsed.videoId };
  return { kind: "keywords", keywords: input.split(/\s+/) };
}

export function searchHistory(records: HistoryRecord[], query: Query): HistoryRecord[] {
  return records.filter((record) => matchesQuery(record, query)).toSorted(byNewestFirst);
}

export function formatHistory(records: HistoryRecord[], query: Query): string {
  if (records.length === 0) return emptyMessage(query);
  return records.map(formatRecord).join("\n");
}

export function parseMeta(raw: string): StoredMeta | undefined {
  const json = tryParseJson(raw) as Partial<StoredMeta> | undefined;
  if (typeof json?.title !== "string" || typeof json.url !== "string" || typeof json.durationSeconds !== "number") return undefined;
  const createdAt = typeof json.createdAt === "string" ? json.createdAt : "";
  return { title: json.title, url: json.url, durationSeconds: json.durationSeconds, createdAt };
}

export function formatDeleteSummary(record: HistoryRecord, sizeBytes: number): string {
  return [`${titleOf(record)}（${durationOf(record)}）`, `  ${record.dir}/  ${record.files.join(", ")}（${formatMegabytes(sizeBytes)}）`].join("\n");
}

// ===== Main Flow =====

const STATUS_LABEL = { transcribed: "✓ 逐字稿", "audio-only": "… 只有音訊", incomplete: "✗ 未完成" } as const;

function matchesQuery(record: HistoryRecord, query: Query): boolean {
  switch (query.kind) {
    case "all":
      return true;
    case "url":
      return record.videoId === query.videoId;
    case "keywords":
      return matchesKeywords(record, query.keywords);
  }
}

function byNewestFirst(a: HistoryRecord, b: HistoryRecord): number {
  return (b.meta?.createdAt ?? "").localeCompare(a.meta?.createdAt ?? "");
}

function emptyMessage(query: Query): string {
  switch (query.kind) {
    case "all":
      return '還沒有任何紀錄，執行 bun transcribe "<網址>" 開始';
    case "url":
      return `找不到 ${query.videoId}，還沒轉過的話執行 bun transcribe ${query.videoId}`;
    case "keywords":
      return `找不到標題符合「${query.keywords.join(" ")}」的影片`;
  }
}

function formatRecord(record: HistoryRecord): string {
  const status = statusOf(record.files);
  const line = `${record.videoId}  ${durationOf(record)}  ${STATUS_LABEL[status]}  ${titleOf(record)}`;
  if (status !== "transcribed") return line;
  return `${line}\n${" ".repeat(record.videoId.length + 2)}${record.dir}/transcript.txt`;
}

// ===== Sub Functions =====

// 單一關鍵字也可能是 videoId；不能只靠「11 個字元」判斷，因為 performance 這種單字也剛好 11 個字元
function matchesKeywords(record: HistoryRecord, keywords: readonly string[]): boolean {
  if (keywords.length === 1 && keywords[0] === record.videoId) return true;
  const title = normalizeForSearch(record.meta?.title ?? "");
  return keywords.every((keyword) => title.includes(normalizeForSearch(keyword)));
}

function statusOf(files: string[]): keyof typeof STATUS_LABEL {
  if (files.includes("transcript.txt")) return "transcribed";
  if (files.includes("audio.m4a")) return "audio-only";
  return "incomplete";
}

function durationOf(record: HistoryRecord): string {
  return record.meta ? formatTimestamp(record.meta.durationSeconds) : "--:--:--";
}

function titleOf(record: HistoryRecord): string {
  return record.meta?.title ?? `（缺少 meta.json，執行 bun transcribe ${record.videoId} 可補上）`;
}

// ===== Utilities =====

// 簡繁、大小寫都統一，搜「软件」也找得到「軟體」
function normalizeForSearch(text: string): string {
  return toTraditional(text.toLowerCase());
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
