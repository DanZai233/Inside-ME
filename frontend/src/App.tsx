import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCustomScriptById,
  loadCustomInterviewScripts,
  newCustomScriptId,
  parseInterviewScriptImport,
  saveCustomInterviewScripts,
  type CustomInterviewScript,
} from "./customInterviewScripts";
import {
  INTERVIEW_PRESETS,
  getInterviewPreset,
  mergeInterviewExtra,
} from "./interviewPresets";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";
import {
  type ApiHealth,
  type ChatMessage,
  type DashboardResponse,
  type DashboardStatsQuery,
  type ImportJobState,
  type ImportPreviewResult,
  type RagHit,
  type RagScope,
  type RagSenderMode,
  type UserSettings,
  cancelImportJob,
  chatStream,
  createChatArchive,
  deleteChatArchive,
  downloadSocialExportCsv,
  exportSkill,
  fetchMetricsText,
  fetchRagPreview,
  fetchSocialExportJson,
  getApiHealth,
  getDashboard,
  getChatArchive,
  listChatArchives,
  getImportJobStatus,
  getSettings,
  getUiApiBearer,
  importFile,
  importPreview,
  startImportJob,
  patchProfile,
  saveSettings,
  setUiApiBearer,
  summarizeProfile,
} from "./api";
import { MemoryAdmin } from "./MemoryAdmin";
import { MemoryVault } from "./MemoryVault";

/** 新建对话时预置在输入框的开场说明，可直接发送或改写成你自己的话。 */
const DEFAULT_CHAT_OPENER = `你好。我想和「过往与当下的自己」认真说说话。

请以坦诚、不评判的态度回应；若与本地检索到的记忆相关，请自然融入你的理解，不必逐条点名出处。

今天我最想先聊的是：
`;

type ChatSessionV = {
  id: string;
  title: string;
  messages: ChatMessage[];
  extraSystem: string;
  updatedAt: number;
};

const CHAT_STORE_KEY = "inside-me-chat-v1";
const LS_RAG_SLICE = "inside-me-rag-slice-v1";
const LS_RAG_SENDER_MODE = "inside-me-rag-sender-mode";
const LS_RAG_THREAD = "inside-me-rag-thread-v1";

function readChatStore(): { activeId: string; sessions: ChatSessionV[] } {
  try {
    const raw = localStorage.getItem(CHAT_STORE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as { activeId: string; sessions: ChatSessionV[] };
      if (Array.isArray(j.sessions) && j.sessions.length > 0 && j.activeId) return j;
    }
  } catch {
    /* ignore */
  }
  const id = crypto.randomUUID();
  const s: ChatSessionV = {
    id,
    title: "默认会话",
    messages: [],
    extraSystem: "",
    updatedAt: Date.now(),
  };
  return { activeId: id, sessions: [s] };
}

type Tab = "dashboard" | "import" | "memory" | "chat" | "settings" | "skill";

type BookmarkEntry = { id: string; role: string; content: string; createdAt: number };

const BOOKMARKS_KEY = "inside-me-bookmarks-v1";

function loadBookmarks(): BookmarkEntry[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as BookmarkEntry[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function saveBookmarks(rows: BookmarkEntry[]) {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(rows));
}

const THEME_KEY = "inside-me-theme";
const LS_INTERVIEW_PRESET = "inside-me-interview-preset-id";

function readRagSlice(): { p: string; f: string; t: string } {
  try {
    const raw = localStorage.getItem(LS_RAG_SLICE);
    if (!raw) return { p: "", f: "", t: "" };
    const o = JSON.parse(raw) as { p?: string; f?: string; t?: string };
    return {
      p: typeof o.p === "string" ? o.p : "",
      f: typeof o.f === "string" ? o.f : "",
      t: typeof o.t === "string" ? o.t : "",
    };
  } catch {
    return { p: "", f: "", t: "" };
  }
}

function readRagThread(): string {
  try {
    const v = localStorage.getItem(LS_RAG_THREAD);
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

export default function App() {
  const boot = readChatStore();
  const bootActive = boot.sessions.find((s) => s.id === boot.activeId) ?? boot.sessions[0];

  const [tab, setTab] = useState<Tab>("dashboard");
  const [dash, setDash] = useState<DashboardResponse | null>(null);
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    api_base_url: "https://api.openai.com",
    api_key: "",
    model: "gpt-4o-mini",
    use_remote_embedding: false,
    embedding_model: "",
    embedding_ark_multimodal: false,
    self_sender_aliases: [],
    chat_prompt_templates: [],
    chat_quick_prompts: [],
  });
  const [sessions, setSessions] = useState<ChatSessionV[]>(() => boot.sessions);
  const [activeSessionId, setActiveSessionId] = useState(() => boot.activeId);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => bootActive.messages);
  const [extraSystem, setExtraSystem] = useState(() => bootActive.extraSystem);
  const [input, setInput] = useState(DEFAULT_CHAT_OPENER);
  const [rag, setRag] = useState(true);
  const [chatMode, setChatMode] = useState<"default" | "interview">("default");
  const [persistChatToMemory, setPersistChatToMemory] = useState(true);
  const [previewHits, setPreviewHits] = useState<RagHit[]>([]);
  const [injectedHits, setInjectedHits] = useState<RagHit[]>([]);
  const [streamCharCount, setStreamCharCount] = useState(0);
  const [vaultStreaming, setVaultStreaming] = useState(false);
  const [pinnedMemory, setPinnedMemory] = useState<RagHit | null>(null);
  const ragPreviewSeq = useRef(0);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const pendingImportFileRef = useRef<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [skillName, setSkillName] = useState("my-inside-me");
  const [skillUseLlm, setSkillUseLlm] = useState(true);
  const [notes, setNotes] = useState({
    persona_summary: "",
    values_notes: "",
    fear_desire_notes: "",
  });
  const [importDedupe, setImportDedupe] = useState(true);
  const [importPreviewData, setImportPreviewData] = useState<ImportPreviewResult | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() => loadBookmarks());
  const [citationsOpen, setCitationsOpen] = useState(true);
  const [uiApiBearer, setUiApiBearerState] = useState(() => getUiApiBearer());
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark") return t;
    } catch {
      /* ignore */
    }
    return "dark";
  });
  const [interviewPresetId, setInterviewPresetId] = useState(() => {
    try {
      return localStorage.getItem(LS_INTERVIEW_PRESET) ?? "";
    } catch {
      return "";
    }
  });
  const [ragPlatform, setRagPlatform] = useState(() => readRagSlice().p);
  const [ragTsFrom, setRagTsFrom] = useState(() => readRagSlice().f);
  const [ragTsTo, setRagTsTo] = useState(() => readRagSlice().t);
  const [ragThread, setRagThread] = useState(() => readRagThread());
  const [ragSenderMode, setRagSenderMode] = useState<RagSenderMode>(() => {
    try {
      const v = localStorage.getItem(LS_RAG_SENDER_MODE);
      if (v === "self_only" || v === "exclude_self" || v === "any") return v;
    } catch {
      /* ignore */
    }
    return "any";
  });
  const [customScripts, setCustomScripts] = useState<CustomInterviewScript[]>(() => loadCustomInterviewScripts());
  const [scriptImportDraft, setScriptImportDraft] = useState("");
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importJobStatus, setImportJobStatus] = useState<ImportJobState | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const speechRecRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);

  const [dashFPlatform, setDashFPlatform] = useState("");
  const [dashFTsFrom, setDashFTsFrom] = useState("");
  const [dashFTsTo, setDashFTsTo] = useState("");
  const [dashFThread, setDashFThread] = useState("");
  const [dashFSender, setDashFSender] = useState<RagSenderMode>("any");
  const [dashTimeGran, setDashTimeGran] = useState<"day" | "week">("day");
  const [pendingMemorySearch, setPendingMemorySearch] = useState<string | null>(null);
  const [chatArchives, setChatArchives] = useState<
    { id: string; name: string; created_at: string; message_count: number }[]
  >([]);
  const [archiveNameDraft, setArchiveNameDraft] = useState("");
  const [templatesJsonDraft, setTemplatesJsonDraft] = useState("[]");
  const [quickPromptsDraft, setQuickPromptsDraft] = useState("");

  const [appliedDashboardQuery, setAppliedDashboardQuery] = useState<DashboardStatsQuery>({
    timeline_granularity: "day",
  });

  const buildDashQueryFromForm = useCallback((): DashboardStatsQuery => {
    const q: DashboardStatsQuery = { timeline_granularity: dashTimeGran };
    if (dashFPlatform.trim()) q.stats_platform = dashFPlatform.trim();
    if (dashFTsFrom.trim()) q.stats_ts_from = dashFTsFrom.trim();
    if (dashFTsTo.trim()) q.stats_ts_to = dashFTsTo.trim();
    if (dashFThread.trim()) q.stats_thread = dashFThread.trim();
    if (dashFSender !== "any") q.stats_sender_mode = dashFSender;
    return q;
  }, [dashFPlatform, dashFTsFrom, dashFTsTo, dashFThread, dashFSender, dashTimeGran]);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const d = await getDashboard(appliedDashboardQuery);
      setDash(d);
      const p = d.profile;
      setNotes({
        persona_summary: p.persona_summary ?? "",
        values_notes: p.values_notes ?? "",
        fear_desire_notes: p.fear_desire_notes ?? "",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    try {
      setApiHealth(await getApiHealth());
    } catch {
      setApiHealth(null);
    }
  }, [appliedDashboardQuery]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setAppliedDashboardQuery((prev) => {
      if (prev.timeline_granularity === dashTimeGran) return prev;
      return { ...prev, timeline_granularity: dashTimeGran };
    });
  }, [dashTimeGran]);

  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings();
        setSettings(s);
        setTemplatesJsonDraft(JSON.stringify(s.chat_prompt_templates ?? [], null, 2));
        setQuickPromptsDraft((s.chat_quick_prompts ?? []).join("\n"));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_INTERVIEW_PRESET, interviewPresetId);
    } catch {
      /* ignore */
    }
  }, [interviewPresetId]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_RAG_SLICE, JSON.stringify({ p: ragPlatform, f: ragTsFrom, t: ragTsTo }));
    } catch {
      /* ignore */
    }
  }, [ragPlatform, ragTsFrom, ragTsTo]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_RAG_THREAD, ragThread);
    } catch {
      /* ignore */
    }
  }, [ragThread]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_RAG_SENDER_MODE, ragSenderMode);
    } catch {
      /* ignore */
    }
  }, [ragSenderMode]);

  useEffect(() => {
    if (!importJobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await getImportJobStatus(importJobId);
        if (cancelled) return;
        setImportJobStatus(st);
        if (st.status === "done" || st.status === "error" || st.status === "cancelled") {
          if (st.status === "done") {
            const skip = st.skipped_duplicates ?? 0;
            setToast(
              skip
                ? `后台导入完成：新增 ${st.imported ?? 0} 条、跳过重复 ${skip}（${st.platform ?? "?"}）`
                : `后台导入完成：共 ${st.imported ?? 0} 条（${st.platform ?? "?"}）`,
            );
            setImportPreviewData(null);
            pendingImportFileRef.current = null;
            await refresh();
          } else if (st.status === "error") {
            setErr(st.error ?? "后台导入失败");
          } else {
            setToast("后台导入已取消");
          }
          setImportJobId(null);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setImportJobId(null);
        }
      }
    };
    const id = window.setInterval(() => void tick(), 500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [importJobId, refresh]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSessions((prev) => {
        const next = prev.map((s) =>
          s.id === activeSessionId ? { ...s, messages: chatMessages, extraSystem, updatedAt: Date.now() } : s,
        );
        try {
          localStorage.setItem(CHAT_STORE_KEY, JSON.stringify({ activeId: activeSessionId, sessions: next }));
        } catch {
          /* ignore */
        }
        return next;
      });
    }, 500);
    return () => clearTimeout(t);
  }, [chatMessages, extraSystem, activeSessionId]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORE_KEY, JSON.stringify({ activeId: activeSessionId, sessions }));
    } catch {
      /* ignore */
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ragScope = useMemo(
    (): RagScope => ({
      rag_platform: ragPlatform.trim() || null,
      rag_ts_from: ragTsFrom.trim() || null,
      rag_ts_to: ragTsTo.trim() || null,
      rag_thread: ragThread.trim() || null,
      rag_sender_mode: ragSenderMode,
    }),
    [ragPlatform, ragTsFrom, ragTsTo, ragThread, ragSenderMode],
  );

  useEffect(() => {
    if (tab !== "chat" || !rag) {
      setPreviewHits([]);
      return;
    }
    const q = input.trim();
    if (q.length < 2) {
      setPreviewHits([]);
      return;
    }
    const seq = ++ragPreviewSeq.current;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const { rag_hits } = await fetchRagPreview(q, 8, ragScope);
          if (seq === ragPreviewSeq.current) setPreviewHits(rag_hits);
        } catch {
          if (seq === ragPreviewSeq.current) setPreviewHits([]);
        }
      })();
    }, 400);
    return () => {
      window.clearTimeout(t);
      ragPreviewSeq.current += 1;
    };
  }, [input, rag, tab, ragScope]);

  useEffect(() => {
    if (tab !== "chat") return;
    const el = chatLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [tab, chatMessages]);

  useEffect(() => {
    if (tab !== "chat") return;
    void listChatArchives()
      .then((r) => setChatArchives(r.archives))
      .catch(() => {});
  }, [tab]);

  const copyAssistantText = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => setToast("已复制到剪贴板"),
      () => setErr("无法写入剪贴板"),
    );
  }, []);

  const copyChatAsMarkdown = useCallback(() => {
    const parts = chatMessages.filter((m) => m.content.trim());
    if (parts.length === 0) {
      setToast("暂无消息可复制");
      return;
    }
    const md = parts.map((m) => `### ${m.role}\n\n${m.content.trim()}\n`).join("\n");
    void navigator.clipboard.writeText(md).then(
      () => setToast("已复制整段对话（Markdown）"),
      () => setErr("无法写入剪贴板"),
    );
  }, [chatMessages]);

  const switchSession = (id: string) => {
    if (id === activeSessionId) return;
    const patched = sessions.map((s) =>
      s.id === activeSessionId ? { ...s, messages: chatMessages, extraSystem, updatedAt: Date.now() } : s,
    );
    const tgt = patched.find((s) => s.id === id);
    if (!tgt) return;
    setSessions(patched);
    setActiveSessionId(id);
    setChatMessages(tgt.messages);
    setExtraSystem(tgt.extraSystem);
    setInjectedHits([]);
    setPreviewHits([]);
    setPinnedMemory(null);
    try {
      localStorage.setItem(CHAT_STORE_KEY, JSON.stringify({ activeId: id, sessions: patched }));
    } catch {
      /* ignore */
    }
  };

  const newSession = () => {
    const patched = sessions.map((s) =>
      s.id === activeSessionId ? { ...s, messages: chatMessages, extraSystem, updatedAt: Date.now() } : s,
    );
    const nid = crypto.randomUUID();
    const neu: ChatSessionV = {
      id: nid,
      title: `会话 ${patched.length + 1}`,
      messages: [],
      extraSystem: "",
      updatedAt: Date.now(),
    };
    const next = [...patched, neu];
    setSessions(next);
    setActiveSessionId(nid);
    setChatMessages([]);
    setExtraSystem("");
    setInput(DEFAULT_CHAT_OPENER);
    setInjectedHits([]);
    setPreviewHits([]);
    setPinnedMemory(null);
    try {
      localStorage.setItem(CHAT_STORE_KEY, JSON.stringify({ activeId: nid, sessions: next }));
    } catch {
      /* ignore */
    }
  };

  const stopStream = () => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setVaultStreaming(false);
    setBusy(false);
  };

  const speakText = (text: string) => {
    const t = text.trim();
    if (!t || typeof window.speechSynthesis === "undefined") {
      setToast("当前环境不支持朗读");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "zh-CN";
    window.speechSynthesis.speak(u);
  };

  const toggleBookmark = (role: string, content: string) => {
    const snippet = content.slice(0, 4000);
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.role === role && b.content === snippet);
      let next: BookmarkEntry[];
      if (exists) next = prev.filter((b) => !(b.role === role && b.content === snippet));
      else next = [...prev, { id: crypto.randomUUID(), role, content: snippet, createdAt: Date.now() }];
      saveBookmarks(next);
      setToast(exists ? "已取消书签" : "已加入书签");
      return next;
    });
  };

  const platformData = useMemo(() => {
    const p = dash?.profile.platforms ?? {};
    return Object.entries(p).map(([name, value]) => ({ name, value }));
  }, [dash]);

  const senderData = useMemo(() => {
    const rows = dash?.social?.top_senders ?? [];
    return rows.slice(0, 18).map((s) => ({
      name: s.name.length > 12 ? `${s.name.slice(0, 12)}…` : s.name,
      value: s.count,
      isSelf: Boolean(s.is_self),
    }));
  }, [dash]);

  const presetAppendForChat = useMemo(() => {
    if (chatMode !== "interview") return "";
    if (interviewPresetId.startsWith("custom:")) {
      return getCustomScriptById(customScripts, interviewPresetId)?.systemAppend ?? "";
    }
    return getInterviewPreset(interviewPresetId)?.systemAppend ?? "";
  }, [chatMode, interviewPresetId, customScripts]);

  const mergedForChat = useMemo(() => {
    return mergeInterviewExtra(presetAppendForChat, extraSystem);
  }, [presetAppendForChat, extraSystem]);

  const interviewHintText = useMemo(() => {
    if (interviewPresetId.startsWith("custom:")) {
      return getCustomScriptById(customScripts, interviewPresetId)?.hint ?? "";
    }
    return getInterviewPreset(interviewPresetId)?.hint ?? "";
  }, [interviewPresetId, customScripts]);

  const timelineItems = useMemo(() => {
    type Tl = { kind: "session" | "bookmark"; id: string; title: string; ts: number };
    const sess: Tl[] = sessions.map((s) => ({
      kind: "session",
      id: s.id,
      title: s.title || "未命名会话",
      ts: s.updatedAt,
    }));
    const bm: Tl[] = bookmarks.map((b) => ({
      kind: "bookmark",
      id: b.id,
      title: `${b.role}: ${b.content.slice(0, 56)}${b.content.length > 56 ? "…" : ""}`,
      ts: b.createdAt,
    }));
    return [...sess, ...bm].sort((a, b) => b.ts - a.ts).slice(0, 48);
  }, [sessions, bookmarks]);

  const startVoiceInput = useCallback(() => {
    type Rec = {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      start: () => void;
      stop: () => void;
      onresult: ((this: Rec, ev: Event) => void) | null;
      onerror: ((this: Rec, ev: Event) => void) | null;
      onend: ((this: Rec, ev: Event) => void) | null;
    };
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SR) {
      setToast("当前浏览器不支持语音识别");
      return;
    }
    if (voiceListening) {
      speechRecRef.current?.stop();
      setVoiceListening(false);
      return;
    }
    const r = new SR();
    r.lang = "zh-CN";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (ev) => {
      const res = (ev as unknown as { results: ArrayLike<{ 0: { transcript: string } }> }).results;
      const t = (res[0]?.[0]?.transcript ?? "").trim();
      if (t) setInput((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t));
      setVoiceListening(false);
    };
    r.onerror = () => {
      setVoiceListening(false);
      setToast("语音识别中断");
    };
    r.onend = () => setVoiceListening(false);
    speechRecRef.current = r;
    try {
      r.start();
      setVoiceListening(true);
    } catch {
      setToast("无法启动麦克风");
      setVoiceListening(false);
    }
  }, [voiceListening]);

  const exportCurrentSession = useCallback(() => {
    const sess = sessions.find((x) => x.id === activeSessionId);
    const safe = (sess?.title || "session").replace(/[^\w\u4e00-\u9fff.-]+/gu, "_").slice(0, 48);
    const meta = {
      title: sess?.title ?? "",
      exportedAt: new Date().toISOString(),
      chatMode,
      interviewPresetId,
      extraSystem,
      messages: chatMessages.filter((m) => m.content.trim()),
    };
    const md = [
      "## 元数据",
      "```json",
      JSON.stringify(meta, null, 2),
      "```",
      "",
      "## 消息",
      ...meta.messages.map((m) => `### ${m.role}\n\n${m.content.trim()}\n`),
    ].join("\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `inside-me-${safe}.md`;
    a.click();
    URL.revokeObjectURL(u);
    setToast("已导出当前会话为 Markdown");
  }, [sessions, activeSessionId, chatMode, interviewPresetId, extraSystem, chatMessages]);

  const deleteCustomScript = (id: string) => {
    setCustomScripts((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveCustomInterviewScripts(next);
      return next;
    });
    if (interviewPresetId === id) setInterviewPresetId("");
  };

  const addScriptFromImport = () => {
    const p = parseInterviewScriptImport(scriptImportDraft);
    if (!p) {
      setErr("无法解析剧本：请使用 JSON（含 systemAppend）或首行为 # 标题的 Markdown");
      return;
    }
    const neu: CustomInterviewScript = {
      id: newCustomScriptId(),
      label: p.label.slice(0, 120),
      hint: p.hint,
      systemAppend: p.systemAppend,
      updatedAt: Date.now(),
    };
    setCustomScripts((prev) => {
      const next = [neu, ...prev];
      saveCustomInterviewScripts(next);
      return next;
    });
    setScriptImportDraft("");
    setInterviewPresetId(neu.id);
    setToast("已新增自定义剧本并已选中");
  };

  const saveNotes = async () => {
    setBusy(true);
    setErr(null);
    try {
      await patchProfile({
        persona_summary: notes.persona_summary,
        values_notes: notes.values_notes,
        fear_desire_notes: notes.fear_desire_notes,
      });
      setToast("画像笔记已保存");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSummarize = async (useLlm: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await summarizeProfile(useLlm);
      setToast(useLlm ? "已用模型刷新摘要" : "已刷新统计画像");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async () => {
    const t = input.trim();
    if (!t) return;
    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;
    setBusy(true);
    setErr(null);
    const next: ChatMessage[] = [...chatMessages, { role: "user", content: t }];
    setChatMessages(next);
    setInput("");
    setStreamCharCount(0);
    setVaultStreaming(true);
    setInjectedHits([]);
    const assistantIndex = next.length;
    setChatMessages([...next, { role: "assistant", content: "" }]);
    try {
      await chatStream(next, rag, chatMode, pinnedMemory?.text ?? null, {
        onMeta: (rag_hits) => {
          setInjectedHits(rag ? rag_hits : []);
          setPreviewHits([]);
          setStreamCharCount(0);
        },
        onDelta: (chunk) => {
          setStreamCharCount((c) => c + chunk.length);
          setChatMessages((prev) => {
            const copy = [...prev];
            const cur = copy[assistantIndex];
            if (cur && cur.role === "assistant") {
              copy[assistantIndex] = { ...cur, content: cur.content + chunk };
            }
            return copy;
          });
        },
        onDone: () => {
          setVaultStreaming(false);
          streamAbortRef.current = null;
        },
        onError: (msg) => {
          setVaultStreaming(false);
          streamAbortRef.current = null;
          if (msg === "已停止生成") {
            setToast("已停止生成");
          } else {
            setErr(msg);
          }
          setChatMessages((prev) => {
            const copy = [...prev];
            const cur = copy[assistantIndex];
            if (cur?.role === "assistant" && !cur.content.trim()) {
              copy.splice(assistantIndex, 1);
            }
            return copy;
          });
        },
      }, {
        persistToMemory: persistChatToMemory,
        extraSystem: mergedForChat,
        signal: ac.signal,
        ragScope,
      });
    } catch (e) {
      setVaultStreaming(false);
      streamAbortRef.current = null;
      setErr(e instanceof Error ? e.message : String(e));
      setChatMessages((prev) => {
        const copy = [...prev];
        const cur = copy[assistantIndex];
        if (cur?.role === "assistant" && !cur.content.trim()) {
          copy.splice(assistantIndex, 1);
        }
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePinMemory = (hit: RagHit) => {
    setPinnedMemory((p) => (p?.id === hit.id ? null : hit));
  };

  const handleInsertToInput = (hit: RagHit) => {
    const block = `【参考记忆】\n${hit.text}`;
    setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${block}` : block));
  };

  const chartAxis = theme === "light" ? "#5c6473" : "#8b919d";
  const chartTooltipStyle =
    theme === "light"
      ? { background: "#ffffff", border: "1px solid #cfd4dc" }
      : { background: "#14161c", border: "1px solid #2a2e38" };
  const chartTooltipLabel = theme === "light" ? "#1a1d24" : "#e8eaef";
  const chartBarPlatform = theme === "light" ? "#0d8f6e" : "#7ee0c7";
  const chartBarSender = theme === "light" ? "#5b7fd4" : "#9db4ff";
  const chartBarSelfSender = theme === "light" ? "#c77d00" : "#e0a74a";

  return (
    <div className={`layout${tab === "chat" ? " layout--wide" : ""}`}>
      <header className="hero">
        <div className="hero__top">
          <h1>中之我</h1>
          <button
            type="button"
            className="ghost theme-toggle"
            title="切换浅色 / 深色"
            onClick={() => setTheme((x) => (x === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "浅色" : "深色"}
          </button>
        </div>
        <p>
          在本地解析聊天记录、构建向量记忆与画像，并通过对话深化自我觉察；最终导出符合{" "}
          <a href="https://agentskills.io/specification" target="_blank" rel="noreferrer">
            Agent Skills
          </a>{" "}
          标准的数字分身 skill。数据默认仅存本机目录 <code>~/.inside-me</code>。
        </p>
      </header>

      <nav className="tabs" aria-label="主导航">
        {(
          [
            ["dashboard", "仪表盘"],
            ["import", "导入"],
            ["memory", "记忆库"],
            ["chat", "对话"],
            ["skill", "导出 Skill"],
            ["settings", "模型设置"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {err && <div className="error">{err}</div>}
      {toast && (
        <div className="success">
          {toast}{" "}
          <button type="button" className="ghost" onClick={() => setToast(null)}>
            关闭
          </button>
        </div>
      )}

      {tab === "dashboard" && dash && (
        <>
          <div className="stats">
            <div className="stat">
              <strong>{dash.message_count}</strong>
              <span>向量消息条数</span>
            </div>
            <div className="stat">
              <strong>{dash.profile.avg_message_len}</strong>
              <span>抽样平均长度</span>
            </div>
            <div className="stat">
              <strong>{new Date(dash.profile.updated_at).toLocaleString()}</strong>
              <span>画像更新时间</span>
            </div>
            {apiHealth?.vectors != null ? (
              <div className="stat">
                <strong>{apiHealth.vectors}</strong>
                <span>/api/health 向量计数</span>
              </div>
            ) : null}
            {apiHealth?.disk_free_gb != null ? (
              <div className="stat">
                <strong>{apiHealth.disk_free_gb}</strong>
                <span>数据盘剩余 (GB)</span>
              </div>
            ) : null}
            {dash.social?.tagged_self_count != null ? (
              <div className="stat">
                <strong>{dash.social.tagged_self_count}</strong>
                <span>抽样中标记为「本人」的条数</span>
              </div>
            ) : null}
            {dash.social?.tagged_other_count != null ? (
              <div className="stat">
                <strong>{dash.social.tagged_other_count}</strong>
                <span>抽样中有 sender 且非本人</span>
              </div>
            ) : null}
            {dash.social?.untagged_sender_count != null ? (
              <div className="stat">
                <strong>{dash.social.untagged_sender_count}</strong>
                <span>抽样中无发送者元数据</span>
              </div>
            ) : null}
          </div>
          {apiHealth?.data_dir ? (
            <p className="health-path" title={apiHealth.data_dir}>
              数据目录：<code>{apiHealth.data_dir}</code>
            </p>
          ) : null}

          <div className="panel dash-scope-panel">
            <h2>统计范围与导出</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
              筛选作用于<strong>平台分布、发送者、相邻对、高频词、时间轴、话题簇</strong>及下方导出文件；在向量库中最多取{" "}
              {dash.stats_sample_cap ?? 8000} 条样本。当前匹配约 <strong>{dash.stats_matching ?? "—"}</strong> 条
              {dash.filters_active ? "（已启用筛选，画像统计为子集）" : ""}。
            </p>
            <div className="dash-filter-grid">
              <label className="field">
                平台（精确匹配）
                <input
                  value={dashFPlatform}
                  onChange={(e) => setDashFPlatform(e.target.value)}
                  placeholder="如 qq_txt、discord_csv"
                  maxLength={128}
                />
              </label>
              <label className="field">
                时间起
                <input
                  value={dashFTsFrom}
                  onChange={(e) => setDashFTsFrom(e.target.value)}
                  placeholder="YYYY-MM-DD"
                  maxLength={80}
                />
              </label>
              <label className="field">
                时间止
                <input
                  value={dashFTsTo}
                  onChange={(e) => setDashFTsTo(e.target.value)}
                  placeholder="YYYY-MM-DD"
                  maxLength={80}
                />
              </label>
              <label className="field">
                会话 / 频道（metadata.thread）
                <input
                  value={dashFThread}
                  onChange={(e) => setDashFThread(e.target.value)}
                  placeholder="如 Discord 频道名；留空不限"
                  maxLength={500}
                  list="dash-thread-options"
                />
                <datalist id="dash-thread-options">
                  {(dash.thread_options ?? []).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                发送者（依赖本人别名）
                <select
                  value={dashFSender}
                  onChange={(e) => setDashFSender(e.target.value as RagSenderMode)}
                  aria-label="仪表盘发送者筛选"
                >
                  <option value="any">全部</option>
                  <option value="self_only">仅本人</option>
                  <option value="exclude_self">排除本人</option>
                </select>
              </label>
              <label className="field">
                时间轴粒度
                <select
                  value={dashTimeGran}
                  onChange={(e) => setDashTimeGran(e.target.value as "day" | "week")}
                  aria-label="时间轴按日或按周"
                >
                  <option value="day">按日</option>
                  <option value="week">按周</option>
                </select>
              </label>
            </div>
            <div className="row" style={{ marginTop: "0.65rem", flexWrap: "wrap", gap: "0.5rem" }}>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => setAppliedDashboardQuery(buildDashQueryFromForm())}
              >
                应用筛选
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setDashFPlatform("");
                  setDashFTsFrom("");
                  setDashFTsTo("");
                  setDashFThread("");
                  setDashFSender("any");
                  setAppliedDashboardQuery({ timeline_granularity: dashTimeGran });
                }}
              >
                清空筛选
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    await downloadSocialExportCsv(appliedDashboardQuery);
                    setToast("已下载 CSV");
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                导出关系统计 CSV
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    const data = await fetchSocialExportJson(appliedDashboardQuery);
                    const blob = new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json;charset=utf-8",
                    });
                    const u = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = u;
                    a.download = "inside-me-social-export.json";
                    a.click();
                    URL.revokeObjectURL(u);
                    setToast("已下载 JSON");
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                导出 JSON
              </button>
            </div>
          </div>

          {(dash.timeline?.length ?? 0) > 0 ? (
            <div className="panel">
              <h2>时间轴（发言条数）</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: 0 }}>
                仅统计含有效时间戳的消息；非情绪分析，可与话题簇对照看节奏。
              </p>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={dash.timeline ?? []} margin={{ left: 4, right: 8 }}>
                    <XAxis
                      dataKey="period"
                      stroke={chartAxis}
                      tick={{ fill: chartAxis, fontSize: 10 }}
                      interval="preserveStartEnd"
                      angle={-22}
                      textAnchor="end"
                      height={56}
                    />
                    <YAxis stroke={chartAxis} tick={{ fill: chartAxis, fontSize: 11 }} />
                    <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: chartTooltipLabel }} />
                    <Bar dataKey="count" fill={chartBarPlatform} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}

          {(dash.topics?.length ?? 0) > 0 ? (
            <div className="panel">
              <h2>关键词话题簇（轻量）</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: 0 }}>
                按高频词对消息做归类，便于跳转记忆库检索；非向量聚类。
              </p>
              <div className="topic-chip-row">
                {(dash.topics ?? []).map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    className="topic-chip"
                    title="在记忆库中按该词检索正文"
                    onClick={() => {
                      setPendingMemorySearch(t.label);
                      setTab("memory");
                    }}
                  >
                    {t.label}
                    <span className="topic-chip__n">{t.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="panel">
            <h2>平台分布</h2>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={platformData}>
                  <XAxis dataKey="name" stroke={chartAxis} tick={{ fill: chartAxis, fontSize: 12 }} />
                  <YAxis stroke={chartAxis} tick={{ fill: chartAxis, fontSize: 12 }} />
                  <Tooltip contentStyle={chartTooltipStyle} labelStyle={{ color: chartTooltipLabel }} />
                  <Bar dataKey="value" fill={chartBarPlatform} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h2>发送者（抽样）</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
              基于本地向量库中最多 {dash.social?.sample_size ?? 0} 条消息的元数据统计；无发送者列的导入会显示为「未标注」。
              {dash.social?.self_aliases_configured ? (
                <>
                  {" "}
                  已在「模型设置」配置本人别名：<strong>琥珀色柱</strong>为匹配到的本人昵称，<strong>蓝色柱</strong>为其他发送者。
                </>
              ) : (
                <>
                  {" "}
                  在「模型设置」填写<strong>本人在导出里的昵称别名</strong>后，可在此高亮本人并用于 RAG/记忆库筛选。
                </>
              )}
            </p>
            {senderData.length > 0 ? (
              <div style={{ width: "100%", height: Math.min(360, 40 + senderData.length * 28) }}>
                <ResponsiveContainer>
                  <BarChart data={senderData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" stroke={chartAxis} tick={{ fill: chartAxis, fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      stroke={chartAxis}
                      tick={{ fill: chartAxis, fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={{ color: chartTooltipLabel }}
                      formatter={(v: number) => [v, "条"]}
                    />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {senderData.map((entry, i) => (
                        <Cell
                          key={`sender-bar-${i}`}
                          fill={entry.isSelf ? chartBarSelfSender : chartBarSender}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>暂无发送者字段，导入含昵称/帐号列的聊天记录后可见。</p>
            )}
          </div>

          {(dash.social?.adjacent_pairs?.length ?? 0) > 0 && (
            <div className="panel">
              <h2>对话相邻（粗略）</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
                按时间排序后，紧挨两条消息且发送者不同时计数一次（反映来回对话频率，非严谨图论关系网）。
                {dash.social?.self_aliases_configured ? (
                  <>
                    {" "}
                    <strong className="pair-list__hint-self">琥珀色昵称</strong>表示该边含你在「模型设置」中配置的本人别名。
                  </>
                ) : null}
              </p>
              <ul className="pair-list">
                {(dash.social?.adjacent_pairs ?? []).slice(0, 24).map((p) => (
                  <li
                    key={`${p.a}|${p.b}`}
                    className={p.involves_self ? "pair-list__item--self" : undefined}
                  >
                    <span className={`pair-a${p.a_is_self ? " pair-list__name--self" : ""}`}>{p.a}</span>
                    <span className="pair-mid">↔</span>
                    <span className={`pair-b${p.b_is_self ? " pair-list__name--self" : ""}`}>{p.b}</span>
                    <span className="pair-n">{p.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel">
            <h2>高频词（启发用）</h2>
            <div className="terms">
              {(dash.profile.top_terms ?? []).map(([w, c]) => (
                <span key={w}>
                  {w} · {c}
                </span>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>画像笔记</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
              可手写补充；或使用下方按钮调用已配置的模型，根据本地样本生成摘要（仅在你填写 API Key
              时才会请求外网）。
            </p>
            <label className="field">
              自我叙事 / 人格摘要
              <textarea
                value={notes.persona_summary}
                onChange={(e) => setNotes({ ...notes, persona_summary: e.target.value })}
              />
            </label>
            <label className="field" style={{ marginTop: "0.75rem" }}>
              价值观
              <textarea
                value={notes.values_notes}
                onChange={(e) => setNotes({ ...notes, values_notes: e.target.value })}
              />
            </label>
            <label className="field" style={{ marginTop: "0.75rem" }}>
              恐惧与渴望
              <textarea
                value={notes.fear_desire_notes}
                onChange={(e) => setNotes({ ...notes, fear_desire_notes: e.target.value })}
              />
            </label>
            <div className="row" style={{ marginTop: "0.75rem" }}>
              <button type="button" className="primary" disabled={busy} onClick={() => void saveNotes()}>
                保存笔记
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void onSummarize(false)}>
                仅刷新统计
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void onSummarize(true)}>
                用模型生成摘要
              </button>
            </div>
          </div>
        </>
      )}

      {tab === "import" && (
        <div className="panel">
          <h2>上传聊天记录</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
            支持 QQ TXT、微信风格 TXT、微博时间块、Telegram JSON、Discord/类 CSV、通用逐行等。可先预览再导入；默认按内容哈希去重。
            大文件可用<strong>后台导入</strong>：分批写入向量库并显示进度，可随时取消（已写入部分会保留）。
          </p>
          <details className="import-sender-fold">
            <summary>「发送者」是谁？怎么区分我和对方？</summary>
            <div className="import-sender-fold__body">
              <p>
                程序<strong>不会猜测</strong>哪条是你、哪条是别人：只读取<strong>导出文件里已经写好的昵称/帐号</strong>，原样写入每条记忆的{" "}
                <code>sender</code> 元数据，供检索预览与统计展示。
              </p>
              <ul>
                <li>
                  <strong>QQ TXT</strong>：时间行里的昵称（如带 QQ 号括号 <code>昵称(123456789)</code> 或邮箱形态）→ sender
                </li>
                <li>
                  <strong>微信风格 TXT</strong>：<code>日期时间 + 昵称</code> 单独一行，其下一行起为正文 → sender 为该行昵称
                </li>
                <li>
                  <strong>Telegram JSON</strong>：每条消息的 <code>from</code>（名字/用户名）
                </li>
                <li>
                  <strong>Discord / 类 CSV</strong>：<code>author</code>、<code>username</code> 等列
                </li>
                <li>
                  <strong>通用逐行</strong>：形如 <code>名字：内容</code> 时，冒号前为 sender
                </li>
                <li>
                  <strong>微博时间块</strong>：若导出里没有说话人字段，sender 可能为空
                </li>
              </ul>
              <p>
                仪表盘里的「发送者」统计会列出所有不同的 sender 字符串；要对应到「我自己」，请对照<strong>你在该平台上导出时的昵称</strong>，并在<strong>「模型设置 → 本人在导出记录里的昵称别名」</strong>中填写（可多条），即可高亮本人并用于 RAG/记忆库筛选。若原始文件格式混乱，解析器可能无法拆出 sender，整条会当作正文处理。
              </p>
            </div>
          </details>
          {importJobId && importJobStatus ? (
            <div className="import-job-panel" role="status">
              <div className="import-job-panel__head">
                <strong>后台任务</strong>
                <span className="import-job-panel__fn">{importJobStatus.filename}</span>
                <span className="import-job-panel__st">{importJobStatus.status}</span>
              </div>
              {(importJobStatus.embedded_total ?? 0) > 0 ? (
                <progress
                  className="import-job-panel__bar"
                  value={importJobStatus.embedded_done}
                  max={importJobStatus.embedded_total ?? 1}
                />
              ) : null}
              <button
                type="button"
                className="ghost"
                disabled={!["queued", "parsing", "embedding", "profile"].includes(importJobStatus.status)}
                onClick={() => {
                  void cancelImportJob(importJobId).then((r) => {
                    if (r.ok) setToast("已请求取消（下一批写入前生效）");
                  });
                }}
              >
                取消任务
              </button>
            </div>
          ) : null}
          <label className="chat-opt" style={{ marginBottom: "0.75rem" }}>
            <input type="checkbox" checked={importDedupe} onChange={(e) => setImportDedupe(e.target.checked)} />
            <span>导入时跳过与库内完全重复的句子</span>
          </label>
          <input
            type="file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              pendingImportFileRef.current = f;
              setBusy(true);
              setErr(null);
              setImportPreviewData(null);
              try {
                const prev = await importPreview(f);
                setImportPreviewData(prev);
              } catch (ex) {
                setErr(ex instanceof Error ? ex.message : String(ex));
                pendingImportFileRef.current = null;
              } finally {
                setBusy(false);
              }
            }}
          />
          {importPreviewData ? (
            <div className="import-preview">
              <p className="import-preview__meta">
                解析器：<strong>{importPreviewData.platform}</strong>，共{" "}
                <strong>{importPreviewData.total_parsed}</strong> 条；以下为前 {importPreviewData.preview.length}{" "}
                条摘要。
              </p>
              <ul className="import-preview__list">
                {importPreviewData.preview.map((row, i) => (
                  <li key={i}>
                    <span className="import-preview__tag">{row.platform}</span>
                    {row.sender ? <span className="import-preview__sender">{row.sender}</span> : null}
                    <span className="import-preview__text">{row.text}</span>
                  </li>
                ))}
              </ul>
              <div className="import-preview__actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !pendingImportFileRef.current || Boolean(importJobId)}
                  onClick={async () => {
                    const f = pendingImportFileRef.current;
                    if (!f) {
                      setErr("请先选择文件");
                      return;
                    }
                    setBusy(true);
                    setErr(null);
                    try {
                      const r = await importFile(f, importDedupe);
                      const skip = r.skipped_duplicates ?? 0;
                      setToast(
                        skip
                          ? `新增 ${r.imported} 条、跳过重复 ${skip} 条（${r.platform}）`
                          : `已导入 ${r.imported} 条（${r.platform}）`,
                      );
                      setImportPreviewData(null);
                      pendingImportFileRef.current = null;
                      await refresh();
                    } catch (ex) {
                      setErr(ex instanceof Error ? ex.message : String(ex));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  确认导入（同步）
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || !pendingImportFileRef.current || Boolean(importJobId)}
                  onClick={async () => {
                    const f = pendingImportFileRef.current;
                    if (!f) {
                      setErr("请先选择文件");
                      return;
                    }
                    setErr(null);
                    try {
                      const { job_id } = await startImportJob(f, importDedupe);
                      setImportJobStatus(null);
                      setImportJobId(job_id);
                      setToast("已加入后台导入队列");
                    } catch (ex) {
                      setErr(ex instanceof Error ? ex.message : String(ex));
                    }
                  }}
                >
                  后台导入（进度条）
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {tab === "memory" && (
        <MemoryAdmin
          onChanged={() => void refresh()}
          onToast={(s) => setToast(s)}
          onErr={(s) => setErr(s)}
          pendingSearch={pendingMemorySearch}
          onConsumedPendingSearch={() => setPendingMemorySearch(null)}
        />
      )}

      {tab === "chat" && (
        <div className="chat-workbench">
          <MemoryVault
            previewHits={previewHits}
            injectedHits={injectedHits}
            pinnedHit={pinnedMemory}
            onPin={handlePinMemory}
            onClearPin={() => setPinnedMemory(null)}
            onInsertToInput={handleInsertToInput}
            ragEnabled={rag}
            vaultStreaming={vaultStreaming}
            streamCharCount={streamCharCount}
          />
          <div className="chat-main panel chat-main-panel">
            <h2>深度对话</h2>
            <div className="chat-sessions">
              <label className="chat-sessions__label">
                会话
                <select
                  className="chat-sessions__select"
                  value={activeSessionId}
                  onChange={(e) => switchSession(e.target.value)}
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="chat-sessions__label chat-sessions__label--grow">
                标题
                <input
                  className="chat-sessions__title-input"
                  value={sessions.find((s) => s.id === activeSessionId)?.title ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSessions((prev) =>
                      prev.map((s) => (s.id === activeSessionId ? { ...s, title: v } : s)),
                    );
                  }}
                  placeholder="给当前会话起名"
                  maxLength={80}
                />
              </label>
              <button type="button" className="ghost" onClick={newSession}>
                新建会话
              </button>
            </div>
            <label className="field chat-persona">
              人设 / 系统补充（附加到系统提示，仅本轮请求）
              <textarea
                rows={3}
                value={extraSystem}
                onChange={(e) => setExtraSystem(e.target.value)}
                placeholder="例如：回答时多用短句；或扮演更理性的自己复盘情绪…"
              />
            </label>
            {settings.chat_quick_prompts.length > 0 ? (
              <div className="chat-template-row">
                <span className="chat-template-row__label">快捷问句</span>
                <div className="chat-template-row__btns">
                  {settings.chat_quick_prompts.map((line) => (
                    <button
                      key={line}
                      type="button"
                      className="ghost chat-template-chip"
                      onClick={() => setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${line}` : line))}
                    >
                      {line.length > 42 ? `${line.slice(0, 40)}…` : line}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {settings.chat_prompt_templates.length > 0 ? (
              <div className="chat-template-row">
                <span className="chat-template-row__label">系统片段</span>
                <div className="chat-template-row__btns">
                  {settings.chat_prompt_templates.map((tpl) => (
                    <button
                      key={tpl.name + tpl.body.slice(0, 12)}
                      type="button"
                      className="ghost chat-template-chip"
                      title={tpl.body}
                      onClick={() =>
                        setExtraSystem((prev) => {
                          const b = tpl.body.trim();
                          if (!b) return prev;
                          return prev.trim() ? `${prev.trim()}\n\n${b}` : b;
                        })
                      }
                    >
                      {tpl.name || "未命名片段"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <details className="chat-archives-fold">
              <summary>服务端会话存档（写入数据目录）</summary>
              <p className="preset-hint">
                将当前会话消息与「人设」保存到本机，便于换设备前备份或做版本对比。与浏览器 localStorage 里的多会话并行存在。
              </p>
              <div className="chat-archives-fold__row">
                <label className="field chat-archives-fold__name">
                  存档名称
                  <input
                    value={archiveNameDraft}
                    onChange={(e) => setArchiveNameDraft(e.target.value)}
                    placeholder={sessions.find((s) => s.id === activeSessionId)?.title ?? "未命名"}
                    maxLength={120}
                  />
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setErr(null);
                    try {
                      const title =
                        archiveNameDraft.trim() ||
                        sessions.find((s) => s.id === activeSessionId)?.title ||
                        "会话存档";
                      await createChatArchive({
                        name: title,
                        messages: chatMessages,
                        extra_system: extraSystem.trim() || null,
                      });
                      setToast("已保存存档");
                      setArchiveNameDraft("");
                      const r = await listChatArchives();
                      setChatArchives(r.archives);
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  保存当前会话
                </button>
              </div>
              {chatArchives.length > 0 ? (
                <ul className="chat-archives-fold__list">
                  {chatArchives.map((a) => (
                    <li key={a.id}>
                      <span className="chat-archives-fold__title">
                        {a.name}{" "}
                        <small className="preset-hint">
                          {a.message_count} 条 · {a.created_at ? new Date(a.created_at).toLocaleString() : ""}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setErr(null);
                          try {
                            const { archive } = await getChatArchive(a.id);
                            const msgs = archive.messages as ChatMessage[];
                            if (!Array.isArray(msgs)) throw new Error("存档格式异常");
                            setChatMessages(msgs);
                            setExtraSystem(archive.extra_system ?? "");
                            setToast(`已载入：${archive.name}`);
                          } catch (e) {
                            setErr(e instanceof Error ? e.message : String(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        载入
                      </button>
                      <button
                        type="button"
                        className="ghost danger-outline"
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm(`删除存档「${a.name}」？`)) return;
                          setBusy(true);
                          setErr(null);
                          try {
                            await deleteChatArchive(a.id);
                            setToast("已删除存档");
                            const r = await listChatArchives();
                            setChatArchives(r.archives);
                          } catch (e) {
                            setErr(e instanceof Error ? e.message : String(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="preset-hint">暂无服务端存档。</p>
              )}
            </details>
            <p className="chat-lead">
              左侧为<strong>记忆档案</strong>：随输入实时预览检索；发送后模型流式回复时抽屉会<strong>逐条点亮</strong>。默认已预置一段开场白，你可直接改发。勾选「写入本地记忆」时，每轮你与助手的完整句子会进入向量库，与导入的聊天记录一起参与后续 RAG。快捷键：<kbd>Esc</kbd>{" "}
              停止生成；<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> 发送。
            </p>
            <label className="chat-opt">
              <input type="checkbox" checked={rag} onChange={(e) => setRag(e.target.checked)} />
              <span>启用本地向量检索（RAG）</span>
            </label>
            {rag ? (
              <details className="rag-scope-fold">
                <summary>RAG 检索范围（可选，与记忆库筛选一致）</summary>
                <div className="rag-scope-fold__grid">
                  <label className="field rag-scope-fold__field">
                    平台（精确匹配元数据）
                    <input
                      value={ragPlatform}
                      onChange={(e) => setRagPlatform(e.target.value)}
                      placeholder="如 qq_txt、wechat 等，留空则不限"
                      maxLength={128}
                    />
                  </label>
                  <label className="field rag-scope-fold__field">
                    时间起（含）
                    <input
                      value={ragTsFrom}
                      onChange={(e) => setRagTsFrom(e.target.value)}
                      placeholder="如 2024-01-01"
                      maxLength={80}
                    />
                  </label>
                  <label className="field rag-scope-fold__field">
                    时间止（含当日）
                    <input
                      value={ragTsTo}
                      onChange={(e) => setRagTsTo(e.target.value)}
                      placeholder="如 2024-12-31"
                      maxLength={80}
                    />
                  </label>
                  <label className="field rag-scope-fold__field">
                    会话 / 频道（thread）
                    <input
                      value={ragThread}
                      onChange={(e) => setRagThread(e.target.value)}
                      placeholder="与导入 metadata.thread 一致，留空不限"
                      maxLength={500}
                    />
                  </label>
                  <label className="field rag-scope-fold__field">
                    发送者（依赖「模型设置」中的本人别名）
                    <select
                      value={ragSenderMode}
                      onChange={(e) => setRagSenderMode(e.target.value as RagSenderMode)}
                      aria-label="RAG 发送者筛选"
                    >
                      <option value="any">不限</option>
                      <option value="self_only">仅本人发言</option>
                      <option value="exclude_self">排除本人（多看他人对我说的话）</option>
                    </select>
                  </label>
                </div>
                <p className="rag-scope-fold__hint">
                  仅影响向量检索命中；不设平台时仍可按时间在后端多取候选再过滤。无时间戳的记忆在启用时间筛选时会被排除。
                  「仅本人/排除本人」须在设置里填写与导出一致的昵称；未配置别名时这两项不会生效。会话筛选依赖导入时写入的{" "}
                  <code>thread</code>（如 Discord CSV 的频道列）。
                </p>
              </details>
            ) : null}
            <label className="chat-opt">
              <input
                type="checkbox"
                checked={persistChatToMemory}
                onChange={(e) => setPersistChatToMemory(e.target.checked)}
              />
              <span>将每轮对话写入本地记忆库（向量化，供以后检索）</span>
            </label>
            <label className="chat-opt">
              <input
                type="checkbox"
                checked={chatMode === "interview"}
                onChange={(e) => setChatMode(e.target.checked ? "interview" : "default")}
              />
              <span>深度访谈模式（澄清式提问；非专业心理咨询）</span>
            </label>
            {chatMode === "interview" ? (
              <div className="chat-preset-block">
                <label className="field chat-preset">
                  访谈剧本（合并进系统提示，可与下方「人设」同发）
                  <select
                    value={interviewPresetId}
                    onChange={(e) => setInterviewPresetId(e.target.value)}
                    aria-label="访谈剧本"
                  >
                    <optgroup label="内置">
                      {INTERVIEW_PRESETS.map((p) => (
                        <option key={p.id || "none"} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                    {customScripts.length > 0 ? (
                      <optgroup label="自定义（仅本机浏览器）">
                        {customScripts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  <span className="preset-hint">{interviewHintText}</span>
                </label>
                <details className="interview-custom-fold">
                  <summary>自定义剧本：导入 / 管理</summary>
                  <p className="preset-hint">
                    支持 JSON：<code>{`{"label":"标题","systemAppend":"……"}`}</code>；或 Markdown 首行{" "}
                    <code># 标题</code>，其余为剧本正文。
                  </p>
                  <textarea
                    rows={5}
                    className="interview-custom-fold__ta"
                    value={scriptImportDraft}
                    onChange={(e) => setScriptImportDraft(e.target.value)}
                    placeholder="粘贴 JSON 或 Markdown…"
                  />
                  <div className="interview-custom-fold__row">
                    <button type="button" className="ghost" onClick={addScriptFromImport}>
                      解析并新增
                    </button>
                  </div>
                  {customScripts.length > 0 ? (
                    <ul className="interview-custom-fold__list">
                      {customScripts.map((c) => (
                        <li key={c.id}>
                          <span className="interview-custom-fold__name">{c.label}</span>
                          <button type="button" className="ghost interview-custom-fold__del" onClick={() => deleteCustomScript(c.id)}>
                            删除
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </details>
              </div>
            ) : null}
            {timelineItems.length > 0 ? (
              <details className="timeline-fold">
                <summary>时间线（会话更新与书签，新→旧）</summary>
                <ul className="timeline-fold__list">
                  {timelineItems.map((it) => (
                    <li key={`${it.kind}-${it.id}`}>
                      <span className="timeline-fold__kind">{it.kind === "session" ? "会话" : "书签"}</span>
                      <span className="timeline-fold__title">{it.title}</span>
                      <span className="timeline-fold__ts">{new Date(it.ts).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {injectedHits.length > 0 ? (
              <details
                className="citations-fold"
                open={citationsOpen}
                onToggle={(e) => setCitationsOpen((e.target as HTMLDetailsElement).open)}
              >
                <summary>
                  本轮检索引用（{injectedHits.length} 条）— 模型已内化，无需逐条复述
                </summary>
                <ol className="citations-fold__list">
                  {injectedHits.map((h) => (
                    <li key={h.id}>
                      <span className="citations-fold__meta">
                        {h.platform} {h.sender ? `· ${h.sender}` : ""}
                      </span>
                      <span className="citations-fold__txt">{h.preview || h.text.slice(0, 200)}</span>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
            {bookmarks.length > 0 ? (
              <details className="bookmarks-fold">
                <summary>书签（{bookmarks.length}）</summary>
                <ul className="bookmarks-fold__list">
                  {bookmarks.map((b) => (
                    <li key={b.id}>
                      <span className="bookmarks-fold__role">{b.role}</span>
                      <span className="bookmarks-fold__snippet">
                        {b.content.length > 120 ? `${b.content.slice(0, 120)}…` : b.content}
                      </span>
                      <button
                        type="button"
                        className="ghost bookmarks-fold__rm"
                        onClick={() => {
                          setBookmarks((prev) => {
                            const next = prev.filter((x) => x.id !== b.id);
                            saveBookmarks(next);
                            return next;
                          });
                        }}
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div ref={chatLogRef} className="chat-log chat-log--framed">
              {chatMessages.length === 0 && (
                <div className="chat-log-placeholder">在「模型设置」中配置 API Key 后开始对话。</div>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`bubble ${m.role === "user" ? "user" : "assistant"}`}>
                  <div className="bubble__head">
                    <div className="role">{m.role}</div>
                    {m.role === "assistant" && m.content ? (
                      <div className="bubble__actions">
                        <button type="button" className="bubble-copy" onClick={() => copyAssistantText(m.content)}>
                          复制
                        </button>
                        <button type="button" className="bubble-copy" onClick={() => speakText(m.content)}>
                          朗读
                        </button>
                        <button
                          type="button"
                          className="bubble-copy"
                          onClick={() => toggleBookmark("assistant", m.content)}
                        >
                          {bookmarks.some((b) => b.role === "assistant" && b.content === m.content.slice(0, 4000))
                            ? "取消书签"
                            : "书签"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="bubble__body">{m.content}</div>
                </div>
              ))}
            </div>
            <textarea
              className="chat-input"
              rows={5}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.shiftKey) {
                  if (e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (!busy) void sendChat();
                  return;
                }
                if (e.key !== "Enter" || e.shiftKey) return;
                if (e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (!busy) void sendChat();
              }}
              placeholder="可编辑预置开场白，或自写问题；输入时左侧会预览相关记忆…（Enter 发送，Shift+Enter 换行，⌘/Ctrl+Enter 也可发送）"
            />
            <div className="row chat-actions">
              <button type="button" className="primary" disabled={busy} onClick={() => void sendChat()}>
                发送
              </button>
              <button
                type="button"
                className="ghost danger-outline"
                disabled={!busy}
                onClick={stopStream}
              >
                停止生成
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setInput(DEFAULT_CHAT_OPENER)}
                title="用默认开场白替换当前输入"
              >
                填入开场白
              </button>
              <button
                type="button"
                className="ghost"
                disabled={chatMessages.length === 0}
                onClick={() => copyChatAsMarkdown()}
              >
                复制对话
              </button>
              <button
                type="button"
                className="ghost"
                disabled={chatMessages.length === 0}
                onClick={exportCurrentSession}
              >
                导出会话
              </button>
              <button
                type="button"
                className={`ghost${voiceListening ? " voice-listening" : ""}`}
                onClick={startVoiceInput}
                title="使用浏览器语音识别填入输入框（Chrome / Edge 等）"
              >
                {voiceListening ? "停止听写" : "语音输入"}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setChatMessages([]);
                  setInjectedHits([]);
                  setPreviewHits([]);
                  setPinnedMemory(null);
                  setInput(DEFAULT_CHAT_OPENER);
                }}
              >
                清空对话
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "skill" && (
        <div className="panel">
          <h2>导出 AgentSkills 目录</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
            将在{" "}
            <code>~/.inside-me/exports/&lt;name&gt;/</code> 生成 <code>SKILL.md</code> 与{" "}
            <code>references/MEMORY.md</code>。目录名必须与 <code>name</code> 字段一致。
          </p>
          <div className="row">
            <label className="field">
              skill 名称（小写、连字符）
              <input value={skillName} onChange={(e) => setSkillName(e.target.value)} />
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1.4rem" }}>
              <input type="checkbox" checked={skillUseLlm} onChange={(e) => setSkillUseLlm(e.target.checked)} />
              <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>用模型润色各段落</span>
            </label>
          </div>
          <button
            type="button"
            className="primary"
            style={{ marginTop: "0.75rem" }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await exportSkill(skillName, skillUseLlm);
                setToast(`已写入：${r.path}`);
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            导出
          </button>
        </div>
      )}

      {tab === "settings" && (
        <div className="panel">
          <h2>OpenAI 兼容 API</h2>
          <label className="field" style={{ marginBottom: "1rem" }}>
            后端访问令牌（可选，与环境变量 <code>INSIDE_ME_API_BEARER_TOKEN</code> 一致）
            <input
              type="password"
              autoComplete="off"
              value={uiApiBearer}
              onChange={(e) => {
                setUiApiBearerState(e.target.value);
                setUiApiBearer(e.target.value);
              }}
              placeholder="未设置服务端令牌则留空"
            />
          </label>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
            Key 保存在本机 <code>~/.inside-me/settings.json</code>。留空 API Key 并保存可保留原值。
            火山方舟 Base URL：<code>https://ark.cn-beijing.volces.com/api/v3</code>。
            <strong> 对话模型</strong>与<strong>向量模型</strong>是两项不同配置：前者走{" "}
            <code>chat/completions</code>，后者走 <code>embeddings</code>，不可填同一个接入点 ID。
          </p>
          <label className="field">
            Base URL
            <input
              value={settings.api_base_url}
              onChange={(e) => setSettings({ ...settings, api_base_url: e.target.value })}
              placeholder="https://api.openai.com 或 https://ark.cn-beijing.volces.com/api/v3"
            />
          </label>
          <label className="field" style={{ marginTop: "0.75rem" }}>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={settings.api_key}
              onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
              placeholder="sk-…"
            />
          </label>

          <h3 className="settings-sub">身份与记忆（发送者）</h3>
          <label className="field">
            本人在导出记录里的昵称 / 帐号别名
            <textarea
              rows={4}
              value={settings.self_sender_aliases.join("\n")}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  self_sender_aliases: e.target.value
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .slice(0, 32),
                })
              }
              placeholder={"每行一个，与 QQ/微信/Telegram 等导出里的 sender 一致；也可只填「昵称」以匹配「昵称(123456789)」形态"}
            />
          </label>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.35rem", lineHeight: 1.5 }}>
            保存后写入本机 <code>settings.json</code>。用于：仪表盘发送者高亮、RAG「仅本人/排除本人」、记忆库浏览筛选。最多 32 条，比对时<strong>不区分英文大小写</strong>。
          </p>

          <h3 className="settings-sub">对话（Chat / 补全）</h3>
          <label className="field">
            对话模型 ID
            <input
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              placeholder="如 doubao-seed-… 或 ep-xxxx（聊天用）"
            />
          </label>

          <h3 className="settings-sub">对话模板（本机）</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: 0 }}>
            快捷问句会出现在对话页一键插入输入框；系统片段会追加到「人设 / 系统补充」文本框。均为本地 settings.json。
          </p>
          <label className="field">
            自定义系统片段（JSON 数组，每项含 name、body）
            <textarea
              rows={8}
              className="settings-templates-json"
              value={templatesJsonDraft}
              onChange={(e) => setTemplatesJsonDraft(e.target.value)}
              placeholder='[{"name":"更短句","body":"回答尽量简短，少用比喻。"}]'
            />
          </label>
          <label className="field" style={{ marginTop: "0.65rem" }}>
            快捷问句（每行一条，最多 24 条）
            <textarea
              rows={5}
              value={quickPromptsDraft}
              onChange={(e) => setQuickPromptsDraft(e.target.value)}
              placeholder={"最近一周我最反复纠结的是什么？\n如果把这段对话写给五年后的自己，我会补一句什么？"}
            />
          </label>

          <h3 className="settings-sub">向量（Embedding / 本地 RAG）</h3>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginTop: "0.25rem" }}>
            <input
              type="checkbox"
              checked={settings.use_remote_embedding}
              onChange={(e) => setSettings({ ...settings, use_remote_embedding: e.target.checked })}
              style={{ marginTop: "0.2rem" }}
            />
            <span style={{ color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.45 }}>
              使用云端向量模型（不调本机 ONNX）。向量目录：<code>~/.inside-me/chroma_remote/</code>，与默认{" "}
              <code>chroma/</code> 分离；<strong>勾选后必须填写下方向量模型</strong>，且切换后需<strong>重新导入</strong>。
            </span>
          </label>
          {settings.use_remote_embedding ? (
            <>
              <label className="field" style={{ marginTop: "0.65rem" }}>
                向量模型 ID（必填，须支持 embeddings API）
                <input
                  value={settings.embedding_model}
                  onChange={(e) => setSettings({ ...settings, embedding_model: e.target.value })}
                  placeholder="如 doubao-embedding-vision-251215 或文本 ep-xxxx"
                  required
                  aria-required
                />
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginTop: "0.55rem" }}>
                <input
                  type="checkbox"
                  checked={settings.embedding_ark_multimodal}
                  onChange={(e) =>
                    setSettings({ ...settings, embedding_ark_multimodal: e.target.checked })
                  }
                  style={{ marginTop: "0.2rem" }}
                />
                <span style={{ color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.45 }}>
                  强制使用方舟 <code>/embeddings/multimodal</code>（模型名含 <code>embedding-vision</code>{" "}
                  时会自动走此接口；若你的接入点 ID 不含 vision 字样请勾选）。
                </span>
              </label>
            </>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.5rem", marginBottom: 0 }}>
              未使用云端向量时，RAG 使用 Chroma 内置小模型（首次可能需联网下载）。
            </p>
          )}
          <button
            type="button"
            className="primary"
            style={{ marginTop: "0.75rem" }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                if (settings.use_remote_embedding) {
                  const em = settings.embedding_model.trim();
                  if (!em) {
                    setErr("已开启云端向量：请填写「向量模型 ID」（与对话模型不同）。");
                    setBusy(false);
                    return;
                  }
                  if (em === settings.model.trim()) {
                    setErr("向量模型不能与对话模型填同一个 ID。请在方舟为 Embedding 单独创建接入点。");
                    setBusy(false);
                    return;
                  }
                }
                let parsedTemplates: { name: string; body: string }[] = [];
                try {
                  const raw = JSON.parse(templatesJsonDraft || "[]") as unknown;
                  if (!Array.isArray(raw)) throw new Error("模板须为 JSON 数组");
                  parsedTemplates = raw
                    .map((x) => {
                      if (!x || typeof x !== "object") return null;
                      const o = x as { name?: unknown; body?: unknown };
                      return {
                        name: String(o.name ?? "").slice(0, 80),
                        body: String(o.body ?? "").slice(0, 8000),
                      };
                    })
                    .filter((x): x is { name: string; body: string } => Boolean(x && (x.name || x.body)))
                    .slice(0, 24);
                } catch {
                  setErr("自定义系统片段 JSON 无法解析，请检查格式。");
                  setBusy(false);
                  return;
                }
                const quickLines = quickPromptsDraft
                  .split(/\n/)
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .slice(0, 24);
                await saveSettings({
                  ...settings,
                  chat_prompt_templates: parsedTemplates,
                  chat_quick_prompts: quickLines,
                });
                setToast("设置已保存");
                const s = await getSettings();
                setSettings(s);
                setTemplatesJsonDraft(JSON.stringify(s.chat_prompt_templates ?? [], null, 2));
                setQuickPromptsDraft((s.chat_quick_prompts ?? []).join("\n"));
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            保存
          </button>
          <div className="settings-ops">
            <h3 className="settings-sub">运维</h3>
            <p>
              结构化日志：启动前设置环境变量 <code>INSIDE_ME_LOG_JSON=1</code>，服务将往 stderr 输出单行 JSON。
            </p>
            <p>
              Prometheus 指标：<code>GET /api/metrics</code>（与 <code>/api/health</code> 相同，默认不要求 Bearer）。
            </p>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                void fetchMetricsText()
                  .then((t) => {
                    void navigator.clipboard.writeText(t).then(
                      () => setToast("已复制指标文本到剪贴板"),
                      () => setErr("无法写入剪贴板"),
                    );
                  })
                  .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
              }}
            >
              复制当前指标快照
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
