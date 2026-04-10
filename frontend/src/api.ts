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

export type DashboardStatsQuery = {
  stats_platform?: string;
  stats_ts_from?: string;
  stats_ts_to?: string;
  stats_thread?: string;
  stats_sender_mode?: "any" | "self_only" | "exclude_self";
  timeline_granularity?: "day" | "week";
};

export type TimelineBucket = { period: string; count: number };
export type TopicCluster = { label: string; count: number; sample_id: string };

export async function getDashboard(q?: DashboardStatsQuery): Promise<DashboardResponse> {
  const sp = new URLSearchParams();
  if (q?.stats_platform?.trim()) sp.set("stats_platform", q.stats_platform.trim());
  if (q?.stats_ts_from?.trim()) sp.set("stats_ts_from", q.stats_ts_from.trim());
  if (q?.stats_ts_to?.trim()) sp.set("stats_ts_to", q.stats_ts_to.trim());
  if (q?.stats_thread?.trim()) sp.set("stats_thread", q.stats_thread.trim());
  if (q?.stats_sender_mode && q.stats_sender_mode !== "any") {
    sp.set("stats_sender_mode", q.stats_sender_mode);
  }
  if (q?.timeline_granularity) sp.set("timeline_granularity", q.timeline_granularity);
  const qs = sp.toString();
  const r = await fetch(`/api/dashboard${qs ? `?${qs}` : ""}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getSettings(): Promise<UserSettings> {
  const r = await fetch("/api/settings", { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  const s = (await r.json()) as Partial<UserSettings>;
  const templates = Array.isArray(s.chat_prompt_templates)
    ? (s.chat_prompt_templates as { name?: string; body?: string }[])
        .map((x) => ({ name: String(x.name ?? "").slice(0, 80), body: String(x.body ?? "").slice(0, 8000) }))
        .filter((x) => x.name || x.body)
    : [];
  const quick = Array.isArray(s.chat_quick_prompts)
    ? (s.chat_quick_prompts as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 24)
    : [];
  return {
    api_base_url: s.api_base_url ?? "https://api.openai.com",
    api_key: s.api_key ?? "",
    model: s.model ?? "gpt-4o-mini",
    use_remote_embedding: Boolean(s.use_remote_embedding),
    embedding_model: s.embedding_model ?? "",
    embedding_ark_multimodal: Boolean(s.embedding_ark_multimodal),
    self_sender_aliases: Array.isArray(s.self_sender_aliases)
      ? (s.self_sender_aliases as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [],
    chat_prompt_templates: templates,
    chat_quick_prompts: quick,
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

export type ImportJobState = {
  status: string;
  filename: string;
  parsed_total: number | null;
  embedded_done: number;
  embedded_total: number | null;
  imported: number | null;
  skipped_duplicates: number | null;
  platform: string | null;
  error: string | null;
};

export async function startImportJob(file: File, dedupe = true): Promise<{ job_id: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const q = dedupe ? "" : "?dedupe=false";
  const r = await fetch(`/api/import/job${q}`, { method: "POST", body: fd, headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getImportJobStatus(jobId: string): Promise<ImportJobState> {
  const r = await fetch(`/api/import/job/${encodeURIComponent(jobId)}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function cancelImportJob(jobId: string): Promise<{ ok: boolean }> {
  const r = await fetch(`/api/import/job/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export type ImportPreviewRow = {
  text: string;
  sender: string | null;
  ts: string;
  platform: string;
  thread?: string;
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
  thread?: string;
  tags?: string;
  distance: number | null;
};

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type RagSenderMode = "any" | "self_only" | "exclude_self";

export type RagScope = {
  rag_platform?: string | null;
  rag_ts_from?: string | null;
  rag_ts_to?: string | null;
  rag_thread?: string | null;
  rag_sender_mode?: RagSenderMode;
};

function ragScopeJson(scope: RagScope | undefined): Record<string, unknown> {
  if (!scope) return {};
  const o: Record<string, unknown> = {};
  const p = scope.rag_platform?.trim();
  const f = scope.rag_ts_from?.trim();
  const t = scope.rag_ts_to?.trim();
  if (p) o.rag_platform = p;
  if (f) o.rag_ts_from = f;
  if (t) o.rag_ts_to = t;
  if (scope.rag_sender_mode && scope.rag_sender_mode !== "any") {
    o.rag_sender_mode = scope.rag_sender_mode;
  }
  const th = scope.rag_thread?.trim();
  if (th) o.rag_thread = th;
  return o;
}

export async function fetchRagPreview(
  query: string,
  n = 8,
  scope?: RagScope,
): Promise<{ rag_hits: RagHit[] }> {
  const r = await fetch("/api/chat/rag-preview", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query, n, ...ragScopeJson(scope) }),
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
  ragScope?: RagScope,
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
      ...ragScopeJson(ragScope),
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
  ragScope?: RagScope;
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
  const { persistToMemory = true, extraSystem = null, signal, ragScope } = options;
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
        ...ragScopeJson(ragScope),
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
  thread?: string;
  tag?: string;
  sender_mode?: RagSenderMode;
}): Promise<MemoryBrowseResponse> {
  const sp = new URLSearchParams();
  if (params.limit != null) sp.set("limit", String(params.limit));
  if (params.offset != null) sp.set("offset", String(params.offset));
  if (params.platform?.trim()) sp.set("platform", params.platform.trim());
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.ts_from?.trim()) sp.set("ts_from", params.ts_from.trim());
  if (params.ts_to?.trim()) sp.set("ts_to", params.ts_to.trim());
  if (params.sender_mode && params.sender_mode !== "any") sp.set("sender_mode", params.sender_mode);
  if (params.thread?.trim()) sp.set("thread", params.thread.trim());
  if (params.tag?.trim()) sp.set("tag", params.tag.trim());
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
  thread?: string;
  tags?: string;
}): Promise<{ ok: boolean }> {
  const r = await fetch("/api/memory/item", {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

function socialExportSearchParams(format: "json" | "csv", q: DashboardStatsQuery): string {
  const sp = new URLSearchParams();
  sp.set("format", format);
  if (q.stats_platform?.trim()) sp.set("stats_platform", q.stats_platform.trim());
  if (q.stats_ts_from?.trim()) sp.set("stats_ts_from", q.stats_ts_from.trim());
  if (q.stats_ts_to?.trim()) sp.set("stats_ts_to", q.stats_ts_to.trim());
  if (q.stats_thread?.trim()) sp.set("stats_thread", q.stats_thread.trim());
  if (q.stats_sender_mode && q.stats_sender_mode !== "any") {
    sp.set("stats_sender_mode", q.stats_sender_mode);
  }
  return sp.toString();
}

export async function fetchSocialExportJson(q: DashboardStatsQuery): Promise<unknown> {
  const r = await fetch(`/api/analytics/social-export?${socialExportSearchParams("json", q)}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function downloadSocialExportCsv(q: DashboardStatsQuery): Promise<void> {
  const r = await fetch(`/api/analytics/social-export?${socialExportSearchParams("csv", q)}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
  const blob = await r.blob();
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = "inside-me-social-export.csv";
  a.click();
  URL.revokeObjectURL(u);
}

export type ChatArchiveListItem = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type ChatArchiveFull = ChatArchiveListItem & {
  messages: ChatMessage[];
  extra_system?: string | null;
};

export async function listChatArchives(): Promise<{ archives: ChatArchiveListItem[] }> {
  const r = await fetch("/api/chat/archives", { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function createChatArchive(body: {
  name: string;
  messages: ChatMessage[];
  extra_system?: string | null;
}): Promise<{ archive: ChatArchiveFull }> {
  const r = await fetch("/api/chat/archives", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getChatArchive(id: string): Promise<{ archive: ChatArchiveFull }> {
  const r = await fetch(`/api/chat/archives/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function deleteChatArchive(id: string): Promise<void> {
  const r = await fetch(`/api/chat/archives/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(await parseError(r));
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
  top_senders: { name: string; count: number; is_self?: boolean }[];
  adjacent_pairs: {
    a: string;
    b: string;
    count: number;
    involves_self?: boolean;
    a_is_self?: boolean;
    b_is_self?: boolean;
  }[];
  self_aliases_configured?: boolean;
  tagged_self_count?: number;
  tagged_other_count?: number;
  untagged_sender_count?: number;
};

export type DashboardResponse = {
  message_count: number;
  stats_sample_cap?: number;
  stats_matching?: number;
  filters_active?: boolean;
  stats_filters?: {
    platform?: string | null;
    ts_from?: string | null;
    ts_to?: string | null;
    thread?: string | null;
    sender_mode?: string;
  };
  profile: Profile;
  social: SocialStats;
  timeline?: TimelineBucket[];
  topics?: TopicCluster[];
  thread_options?: string[];
};

export type ChatPromptTemplate = { name: string; body: string };

export type UserSettings = {
  api_base_url: string;
  api_key: string;
  model: string;
  use_remote_embedding: boolean;
  embedding_model: string;
  embedding_ark_multimodal: boolean;
  /** 与导入元数据 sender 比对，用于统计与 RAG/记忆库筛选 */
  self_sender_aliases: string[];
  chat_prompt_templates: ChatPromptTemplate[];
  chat_quick_prompts: string[];
};
