import { formatTimestamp, toTraditional, tryParseJson } from "./utils.ts";

// ===== Usage =====
// 純核心：不碰檔案、不跑指令。shell（cli.ts）負責 I/O，這裡只做決策與格式化。

export type Segment = { start: number; end: number; text: string };
export type VideoMeta = { title: string; url: string; durationSeconds: number };
export type ParsedVideoId = { kind: "ok"; videoId: string } | { kind: "invalid"; input: string };
export type ParsedWhisper = { kind: "ok"; segments: Segment[] } | { kind: "invalid"; reason: string };

export function parseVideoId(input: string): ParsedVideoId {
  const trimmed = input.trim();
  if (VIDEO_ID_PATTERN.test(trimmed)) return { kind: "ok", videoId: trimmed };

  const videoId = videoIdFromUrl(trimmed);
  return videoId ? { kind: "ok", videoId } : { kind: "invalid", input };
}

// Python 的 json.dump 會把 avg_logprob 寫成裸的 NaN / Infinity，不是合法 JSON
export function parseWhisperJson(raw: string): ParsedWhisper {
  const json = tryParseJson(raw.replace(/:\s*-?(NaN|Infinity)\b/g, ": null"));
  const segments = (json as { segments?: unknown } | undefined)?.segments;
  if (!Array.isArray(segments)) return { kind: "invalid", reason: "whisper.json 缺少 segments 陣列" };
  return { kind: "ok", segments: segments.map(({ start, end, text }: Segment) => ({ start, end, text })) };
}

export function buildTranscript(meta: VideoMeta, segments: Segment[]): string {
  const cleaned = dropConsecutiveDuplicates(segments.map(normalizeSegment).filter((s) => s.text !== ""));
  const paragraphs = groupIntoParagraphs(cleaned);
  const header = [`# ${toTraditional(meta.title)}`, `來源：${meta.url}`, `長度：${formatTimestamp(meta.durationSeconds)}`];
  const body = paragraphs.map((p) => `[${formatTimestamp(p.start)}] ${p.text}`);
  return [...header, "", ...body, ""].join("\n");
}

// ===== Main Flow =====

const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const PARAGRAPH_MAX_SECONDS = 60;
const PARAGRAPH_BREAK_GAP_SECONDS = 3;

function videoIdFromUrl(input: string): string | undefined {
  const url = tryParseUrl(input);
  if (!url || !/(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname)) return undefined;

  const candidate = url.hostname.endsWith("youtu.be")
    ? url.pathname.slice(1)
    : (url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]);
  return candidate && VIDEO_ID_PATTERN.test(candidate) ? candidate : undefined;
}

function normalizeSegment(segment: Segment): Segment {
  return { ...segment, text: toTraditional(segment.text.trim()) };
}

// Whisper 遇到靜音或音樂時，偶爾會卡在同一句重複輸出
function dropConsecutiveDuplicates(segments: Segment[]): Segment[] {
  return segments.filter((segment, i) => i === 0 || segment.text !== segments[i - 1]?.text);
}

function groupIntoParagraphs(segments: Segment[]): Segment[] {
  return segments.reduce<Segment[]>((paragraphs, segment) => {
    const last = paragraphs.at(-1);
    if (!last || shouldBreakParagraph(last, segment)) return [...paragraphs, segment];
    return [...paragraphs.slice(0, -1), { start: last.start, end: segment.end, text: joinText(last.text, segment.text) }];
  }, []);
}

// ===== Sub Functions =====

function shouldBreakParagraph(paragraph: Segment, next: Segment): boolean {
  return next.end - paragraph.start > PARAGRAPH_MAX_SECONDS || next.start - paragraph.end >= PARAGRAPH_BREAK_GAP_SECONDS;
}

// 句尾已有標點就直接接上；沒有的話補空白，不猜該放逗號還是句號
function joinText(left: string, right: string): string {
  return /[，。！？、；：,.!?;:]$/.test(left) ? left + right : `${left} ${right}`;
}

// ===== Utilities =====

function tryParseUrl(input: string): URL | undefined {
  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}
