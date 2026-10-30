import { describe, expect, test } from "bun:test";
import { buildTranscript, parseVideoId, parseWhisperJson } from "./transcript.ts";

describe("parseWhisperJson", () => {
  test("容忍 Python 輸出的 NaN / -Infinity，只保留 start、end、text", () => {
    const raw = '{"segments": [{"start": 0.0, "end": 1.5, "text": "NaN 不是數字", "avg_logprob": NaN, "x": -Infinity}]}';
    expect(parseWhisperJson(raw)).toEqual({ kind: "ok", segments: [{ start: 0, end: 1.5, text: "NaN 不是數字" }] });
  });

  test.each([["not json"], ['{"text": "no segments"}']])("%p → invalid", (raw) => {
    expect(parseWhisperJson(raw).kind).toBe("invalid");
  });
});

describe("parseVideoId", () => {
  test.each([
    ["https://www.youtube.com/watch?v=Vv1_CgeDhoc"],
    ["https://www.youtube.com/watch?list=PL123&v=Vv1_CgeDhoc&t=30s"],
    ["https://youtu.be/Vv1_CgeDhoc?si=abc"],
    ["https://m.youtube.com/shorts/Vv1_CgeDhoc"],
    ["https://www.youtube.com/live/Vv1_CgeDhoc"],
    ["  Vv1_CgeDhoc  "],
  ])("%s → Vv1_CgeDhoc", (input) => {
    expect(parseVideoId(input)).toEqual({ kind: "ok", videoId: "Vv1_CgeDhoc" });
  });

  test.each([[""], ["https://vimeo.com/123456"], ["https://www.youtube.com/watch?v=short"], ["not a url"]])(
    "%p → invalid",
    (input) => {
      expect(parseVideoId(input).kind).toBe("invalid");
    },
  );
});

describe("buildTranscript", () => {
  const meta = { title: "简体标题", url: "https://youtu.be/x", durationSeconds: 5165 };

  test("header 與段落皆轉為台灣繁體，並標上時間戳", () => {
    const result = buildTranscript(meta, [{ start: 3725, end: 3730, text: " 这个软件的数据库 " }]);
    expect(result).toBe(
      ["# 簡體標題", "來源：https://youtu.be/x", "長度：01:26:05", "", "[01:02:05] 這個軟體的資料庫", ""].join("\n"),
    );
  });

  test("移除連續重複句與空白句", () => {
    const result = buildTranscript(meta, [
      { start: 0, end: 2, text: "謝謝大家。" },
      { start: 2, end: 4, text: "謝謝大家。" },
      { start: 2, end: 3, text: "  " },
      { start: 3, end: 6, text: "下課。" },
    ]);
    expect(result).toContain("[00:00:00] 謝謝大家。下課。");
  });

  test("超過 60 秒或停頓 3 秒以上就換段；無標點時以空白連接", () => {
    const result = buildTranscript(meta, [
      { start: 0, end: 30, text: "第一句" },
      { start: 30, end: 59, text: "第二句" },
      { start: 59, end: 70, text: "第三句" },
      { start: 80, end: 85, text: "第四句" },
    ]);
    expect(result).toContain("[00:00:00] 第一句 第二句\n[00:00:59] 第三句\n[00:01:20] 第四句");
  });
});
