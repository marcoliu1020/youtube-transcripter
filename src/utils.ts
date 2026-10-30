import { Converter } from "opencc-js";

// ===== Utilities =====
// 純函數、無業務語意，transcript.ts 與 history.ts 共用

export const toTraditional = Converter({ from: "cn", to: "twp" });

export function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}
