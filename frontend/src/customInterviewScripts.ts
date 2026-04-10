/** 用户自定义访谈剧本（仅存浏览器 localStorage，不上传服务器）。 */

const LS = "inside-me-custom-interview-scripts";

export type CustomInterviewScript = {
  id: string;
  label: string;
  hint: string;
  systemAppend: string;
  updatedAt: number;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function loadCustomInterviewScripts(): CustomInterviewScript[] {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    const out: CustomInterviewScript[] = [];
    for (const row of j) {
      if (!isRecord(row)) continue;
      const id = typeof row.id === "string" ? row.id : "";
      const label = typeof row.label === "string" ? row.label : "";
      const systemAppend = typeof row.systemAppend === "string" ? row.systemAppend : "";
      const hint = typeof row.hint === "string" ? row.hint : "";
      const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : Date.now();
      if (!id.startsWith("custom:") || !label.trim() || !systemAppend.trim()) continue;
      out.push({ id, label: label.trim(), hint: hint || "自定义剧本", systemAppend, updatedAt });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveCustomInterviewScripts(scripts: CustomInterviewScript[]): void {
  try {
    localStorage.setItem(LS, JSON.stringify(scripts));
  } catch {
    /* quota / private mode */
  }
}

export function newCustomScriptId(): string {
  return `custom:${crypto.randomUUID()}`;
}

/** 从 JSON 对象 / 数组单元素，或 Markdown（首行 # 标题）解析。 */
export function parseInterviewScriptImport(raw: string): { label: string; systemAppend: string; hint: string } | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const systemAppend = typeof o.systemAppend === "string" ? o.systemAppend.trim() : "";
      if (!systemAppend) return null;
      const label = (typeof o.label === "string" && o.label.trim()) || "自定义";
      const hint = (typeof o.hint === "string" && o.hint.trim()) || "自 JSON 导入";
      return { label: label.slice(0, 120), systemAppend, hint };
    } catch {
      /* fallthrough */
    }
  }
  if (t.startsWith("[")) {
    try {
      const a = JSON.parse(t) as unknown[];
      if (!Array.isArray(a) || a.length === 0) return null;
      const first = a[0];
      if (!isRecord(first)) return null;
      const systemAppend = typeof first.systemAppend === "string" ? first.systemAppend.trim() : "";
      if (!systemAppend) return null;
      const label =
        (typeof first.label === "string" && first.label.trim()) || (typeof first.name === "string" && first.name.trim()) || "自定义";
      return {
        label: label.slice(0, 120),
        systemAppend,
        hint: "自 JSON 数组导入",
      };
    } catch {
      /* fallthrough */
    }
  }
  const lines = t.split("\n");
  let i = 0;
  let label = "自定义剧本";
  const h = lines[0]?.match(/^#{1,2}\s+(.+)/);
  if (h) {
    label = (h[1] ?? "").trim().slice(0, 120) || label;
    i = 1;
  }
  const systemAppend = lines.slice(i).join("\n").trim();
  if (!systemAppend) return null;
  return { label, systemAppend, hint: "自 Markdown / 纯文本导入" };
}

export function getCustomScriptById(scripts: CustomInterviewScript[], id: string): CustomInterviewScript | undefined {
  return scripts.find((c) => c.id === id);
}
