const LS_API_BEARER = "inside-me-ui-bearer";

export function getUiApiBearer(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(LS_API_BEARER) ?? "";
}

export function setUiApiBearer(token: string): void {
  if (typeof localStorage === "undefined") return;
  const t = token.trim();
  if (t) localStorage.setItem(LS_API_BEARER, t);
  else localStorage.removeItem(LS_API_BEARER);
}

function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  const t = getUiApiBearer().trim();
  if (!t) return { ...base };
  return { ...base, Authorization: `Bearer ${t}` };
}

async function parseError(res: Response): Promise<string> {
  try {
    const t = await res.text();
    if (!t) return res.statusText;
    try {
      const j = JSON.parse(t) as { detail?: string | { msg?: string }[] };
      if (typeof j.detail === "string") return j.detail;
      if (Array.isArray(j.detail) && j.detail[0]?.msg) return String(j.detail[0].msg);
    } catch {
      /* not JSON */
    }
    return t;
  } catch {
    return res.statusText;
  }
}

export type ApiHealth = {
  status: string;
  vectors?: number;
  data_dir?: string;
  disk_free_gb?: number | null;
};

export async function getHealth(): Promise<{ status: string }> {
  const r = await fetch("/health");
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getApiHealth(): Promise<ApiHealth> {
  const r = await fetch("/api/health", { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getDashboard(): Promise<DashboardResponse> {
  const r = await fetch("/api/dashboard", { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getSettings(): Promise<UserSettings> {
  const r = await fetch("/api/settings", { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  const s = (await r.json()) as Partial<UserSettings>;
  return {
    api_base_url: s.api_base_url ?? "https://api.openai.com",
    api_key: s.api_key ?? "",
    model: s.model ?? "gpt-4o-mini",
    use_remote_embedding: Boolean(s.use_remote_embedding),
    embedding_model: s.embedding_model ?? "",
    embedding_ark_multimodal: Boolean(s.embedding_ark_multimodal),
  };
}

export async function saveSettings(body: UserSettings): Promise<void> {
  const r = await fetch("/api/settings", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseError(r));
}

export type ImportResult = {
  imported: number;
  skipped_duplicates: number;
  platform: string;
  parsed_messages: number;
};

export async function importFile(file: File, dedupe = true): Promise<ImportResult> {
  const fd = new FormData();
  fd.append("file", file);
  const q = dedupe ? "" : "?dedupe=false";
  const r = await fetch(`/api/import${q}`, { method: "POST", body: fd, headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export type ImportPreviewRow = {
  text: string;
  sender: string | null;
  ts: string;
  platform: string;
};

export type ImportPreviewResult = {
  platform: string;
  total_parsed: number;
  preview: ImportPreviewRow[];
};

export async function importPreview(file: File): Promise<ImportPreviewResult> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/import/preview", { method: "POST", body: fd, headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export type RagHit = {
  id: string;
  text: string;
  preview: string;
  sender: string;
  platform: string;
  ts: string;
  distance: number | null;
};

export async function fetchRagPreview(query: string, n = 8): Promise<{ rag_hits: RagHit[] }> {
  const r = await fetch("/api/chat/rag-preview", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query, n }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function chat(
  messages: ChatMessage[],
  useRag: boolean,
  chatMode: "default" | "interview" = "default",
  pinnedContext: string | null = null,
  persistToMemory = true,
  extraSystem: string | null = null,
): Promise<{ reply: string; rag_hits: RagHit[] }> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      messages,
      use_rag: useRag,
      chat_mode: chatMode,
      pinned_context: pinnedContext || null,
      persist_to_memory: persistToMemory,
      extra_system: extraSystem?.trim() || null,
    }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export type ChatStreamHandlers = {
  onMeta: (rag_hits: RagHit[]) => void;
  onDelta: (content: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

export type ChatStreamOptions = {
  persistToMemory?: boolean;
  extraSystem?: string | null;
  signal?: AbortSignal;
};

/** SSE：首帧 meta，随后 delta，结束 done；错误帧 error。 */
export async function chatStream(
  messages: ChatMessage[],
  useRag: boolean,
  chatMode: "default" | "interview",
  pinnedContext: string | null,
  handlers: ChatStreamHandlers,
  options: ChatStreamOptions = {},
): Promise<void> {
  const { persistToMemory = true, extraSystem = null, signal } = options;
  let r: Response;
  try {
    r = await fetch("/api/chat/stream", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        messages,
        use_rag: useRag,
        chat_mode: chatMode,
        pinned_context: pinnedContext || null,
        persist_to_memory: persistToMemory,
        extra_system: extraSystem?.trim() || null,
      }),
      signal,
    });
  } catch (e) {
    const aborted =
      signal?.aborted ||
      (typeof DOMException !== "undefined" &&
        e instanceof DOMException &&
        e.name === "AbortError");
    if (aborted) handlers.onError("已停止生成");
    else handlers.onError(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!r.ok) {
    handlers.onError(await parseError(r));
    return;
  }
  const reader = r.body?.getReader();
  if (!reader) {
    handlers.onError("无法读取响应流");
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        const chunk = await reader.read();
        done = chunk.done;
        value = chunk.value;
      } catch (e) {
        const aborted =
          signal?.aborted ||
          (typeof DOMException !== "undefined" &&
            e instanceof DOMException &&
            e.name === "AbortError");
        if (aborted) {
          handlers.onError("已停止生成");
          return;
        }
        throw e;
      }
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of rawEvent.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.startsWith("data: ") ? t.slice(6) : t.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let obj: { type?: string; content?: string; message?: string; rag_hits?: RagHit[] };
          try {
            obj = JSON.parse(payload) as typeof obj;
          } catch {
            continue;
          }
          if (obj.type === "meta" && Array.isArray(obj.rag_hits)) {
            handlers.onMeta(obj.rag_hits);
          } else if (obj.type === "delta" && typeof obj.content === "string") {
            handlers.onDelta(obj.content);
          } else if (obj.type === "done") {
            handlers.onDone();
            return;
          } else if (obj.type === "error") {
            handlers.onError(String(obj.message ?? "流式错误"));
            return;
          }
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  handlers.onDone();
}

export async function summarizeProfile(useLlm: boolean): Promise<{ profile: Profile }> {
  const r = await fetch("/api/profile/summarize", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ use_llm: useLlm }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function exportSkill(skillName: string, useLlm: boolean): Promise<{ path: string }> {
  const r = await fetch("/api/skill/export", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ skill_name: skillName, use_llm: useLlm }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function patchProfile(patch: {
  persona_summary?: string;
  values_notes?: string;
  fear_desire_notes?: string;
}): Promise<Profile> {
  const r = await fetch("/api/profile", {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export type MemoryBrowseResponse = {
  items: RagHit[];
  scan_capped?: boolean;
  total_matching?: number | null;
};

export async function browseMemory(params: {
  limit?: number;
  offset?: number;
  platform?: string;
  q?: string;
  ts_from?: string;
  ts_to?: string;
}): Promise<MemoryBrowseResponse> {
  const sp = new URLSearchParams();
  if (params.limit != null) sp.set("limit", String(params.limit));
  if (params.offset != null) sp.set("offset", String(params.offset));
  if (params.platform?.trim()) sp.set("platform", params.platform.trim());
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.ts_from?.trim()) sp.set("ts_from", params.ts_from.trim());
  if (params.ts_to?.trim()) sp.set("ts_to", params.ts_to.trim());
  const q = sp.toString();
  const r = await fetch(`/api/memory/browse${q ? `?${q}` : ""}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

/** Prometheus 文本（与 /api/health 相同免 Bearer） */
export async function fetchMetricsText(): Promise<string> {
  const r = await fetch("/api/metrics");
  if (!r.ok) throw new Error(await parseError(r));
  return r.text();
}

export async function deleteMemoryIds(ids: string[]): Promise<{ deleted: number }> {
  const r = await fetch("/api/memory/delete", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ids }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function patchMemoryItem(body: {
  id: string;
  document?: string;
  sender?: string;
  platform?: string;
  ts?: string;
}): Promise<{ ok: boolean }> {
  const r = await fetch("/api/memory/item", {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

/** 通过 fetch（含可选 Bearer）下载 inside-me-backup.zip */
export async function downloadBackup(): Promise<void> {
  const r = await fetch("/api/backup/download", { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  const blob = await r.blob();
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = "inside-me-backup.zip";
  a.click();
  URL.revokeObjectURL(u);
}

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type Profile = {
  message_count: number;
  platforms: Record<string, number>;
  top_terms: [string, number][];
  avg_message_len: number;
  persona_summary: string;
  values_notes: string;
  fear_desire_notes: string;
  updated_at: string;
};

export type SocialStats = {
  sample_size: number;
  top_senders: { name: string; count: number }[];
  adjacent_pairs: { a: string; b: string; count: number }[];
};

export type DashboardResponse = {
  message_count: number;
  profile: Profile;
  social: SocialStats;
};

export type UserSettings = {
  api_base_url: string;
  api_key: string;
  model: string;
  use_remote_embedding: boolean;
  embedding_model: string;
  embedding_ark_multimodal: boolean;
};
