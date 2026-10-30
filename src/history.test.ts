import { describe, expect, test } from "bun:test";
import { formatDeleteSummary, formatHistory, parseMeta, parseQuery, searchHistory, type HistoryRecord } from "./history.ts";

function record(videoId: string, title: string, createdAt: string, files = ["meta.json", "audio.m4a", "whisper.json", "transcript.txt"]): HistoryRecord {
  return { videoId, dir: `output/${videoId}`, meta: { title, url: `https://youtu.be/${videoId}`, durationSeconds: 5165, createdAt }, files };
}

const alpha = record("Vv1_CgeDhoc", "Alpha Basics and Systematic Approach", "2026-10-30T10:00:00Z");
const operators = record("AAAAAAAAAAA", "Operator 进阶软件教学", "2026-10-31T10:00:00Z", ["meta.json", "audio.m4a"]);
const records = [alpha, operators];

describe("parseQuery", () => {
  test.each([
    [[], { kind: "all" }],
    [["  "], { kind: "all" }],
    [["https://www.youtube.com/watch?v=Vv1_CgeDhoc"], { kind: "url", videoId: "Vv1_CgeDhoc" }],
    [["alpha", "basic"], { kind: "keywords", keywords: ["alpha", "basic"] }],
    [["performance"], { kind: "keywords", keywords: ["performance"] }],
  ])("%p → %p", (args, expected) => {
    expect(parseQuery(args)).toEqual(expected as ReturnType<typeof parseQuery>);
  });
});

describe("searchHistory", () => {
  test("全部列出，新的在前", () => {
    expect(searchHistory(records, { kind: "all" })).toEqual([operators, alpha]);
  });

  test("網址精確比對 videoId", () => {
    expect(searchHistory(records, parseQuery(["https://youtu.be/Vv1_CgeDhoc"]))).toEqual([alpha]);
  });

  test("單獨輸入 videoId 也找得到", () => {
    expect(searchHistory(records, parseQuery(["Vv1_CgeDhoc"]))).toEqual([alpha]);
  });

  test("多個關鍵字必須全部符合，不分大小寫", () => {
    expect(searchHistory(records, parseQuery(["ALPHA", "basics"]))).toEqual([alpha]);
    expect(searchHistory(records, parseQuery(["alpha", "operator"]))).toEqual([]);
  });

  test("簡繁互搜", () => {
    expect(searchHistory(records, parseQuery(["進階軟體"]))).toEqual([operators]);
  });
});

describe("formatHistory", () => {
  test("已完成的顯示逐字稿路徑，只有音訊的不顯示", () => {
    expect(formatHistory([operators, alpha], { kind: "all" })).toBe(
      [
        "AAAAAAAAAAA  01:26:05  … 只有音訊  Operator 进阶软件教学",
        "Vv1_CgeDhoc  01:26:05  ✓ 逐字稿  Alpha Basics and Systematic Approach",
        "             output/Vv1_CgeDhoc/transcript.txt",
      ].join("\n"),
    );
  });

  test("缺少 meta.json 時提示怎麼補", () => {
    const legacy: HistoryRecord = { videoId: "Vv1_CgeDhoc", dir: "output/Vv1_CgeDhoc", meta: undefined, files: [] };
    expect(formatHistory([legacy], { kind: "all" })).toBe("Vv1_CgeDhoc  --:--:--  ✗ 未完成  （缺少 meta.json，執行 bun transcribe Vv1_CgeDhoc 可補上）");
  });

  test.each([
    [{ kind: "all" } as const, "還沒有任何紀錄"],
    [{ kind: "url", videoId: "Vv1_CgeDhoc" } as const, "bun transcribe Vv1_CgeDhoc"],
    [{ kind: "keywords", keywords: ["foo", "bar"] } as const, "「foo bar」"],
  ])("沒有結果時依查詢種類提示：%p", (query, expected) => {
    expect(formatHistory([], query)).toContain(expected);
  });
});

describe("parseMeta", () => {
  test("缺少 createdAt 時補空字串", () => {
    expect(parseMeta('{"title":"t","url":"u","durationSeconds":1}')).toEqual({ title: "t", url: "u", durationSeconds: 1, createdAt: "" });
  });

  test.each([["not json"], ['{"title":"t"}'], ["null"]])("%p → undefined", (raw) => {
    expect(parseMeta(raw)).toBeUndefined();
  });
});

test("formatDeleteSummary 列出標題、檔案與大小", () => {
  expect(formatDeleteSummary(alpha, 108_000_000)).toBe(
    "Alpha Basics and Systematic Approach（01:26:05）\n  output/Vv1_CgeDhoc/  meta.json, audio.m4a, whisper.json, transcript.txt（103.0 MB）",
  );
});
