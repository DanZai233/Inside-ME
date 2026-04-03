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

export async function chat(
  messages: ChatMessage[],
  useRag: boolean,
  chatMode: "default" | "interview" = "default",
): Promise<{ reply: string }> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, use_rag: useRag, chat_mode: chatMode }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json();
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
