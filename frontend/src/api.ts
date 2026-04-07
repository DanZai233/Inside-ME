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

export async function getHealth(): Promise<{ status: string }> {
  const r = await fetch("/health");
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getDashboard(): Promise<DashboardResponse> {
  const r = await fetch("/api/dashboard");
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function getSettings(): Promise<UserSettings> {
  const r = await fetch("/api/settings");
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await parseError(r));
}

export async function importFile(file: File): Promise<{ imported: number; platform: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/import", { method: "POST", body: fd });
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
    headers: { "Content-Type": "application/json" },
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
): Promise<{ reply: string; rag_hits: RagHit[] }> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      use_rag: useRag,
      chat_mode: chatMode,
      pinned_context: pinnedContext || null,
      persist_to_memory: persistToMemory,
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

/** SSE：首帧 meta，随后 delta，结束 done；错误帧 error。 */
export async function chatStream(
  messages: ChatMessage[],
  useRag: boolean,
  chatMode: "default" | "interview",
  pinnedContext: string | null,
  handlers: ChatStreamHandlers,
  persistToMemory = true,
): Promise<void> {
  const r = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      use_rag: useRag,
      chat_mode: chatMode,
      pinned_context: pinnedContext || null,
      persist_to_memory: persistToMemory,
    }),
  });
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
      const { done, value } = await reader.read();
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ use_llm: useLlm }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
}

export async function exportSkill(skillName: string, useLlm: boolean): Promise<{ path: string }> {
  const r = await fetch("/api/skill/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
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
