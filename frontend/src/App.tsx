import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INTERVIEW_PRESETS,
  getInterviewPreset,
  mergeInterviewExtra,
} from "./interviewPresets";
import {
  Bar,
  BarChart,
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
  type ImportPreviewResult,
  type RagHit,
  type UserSettings,
  chatStream,
  exportSkill,
  fetchMetricsText,
  fetchRagPreview,
  getApiHealth,
  getDashboard,
  getSettings,
  getUiApiBearer,
  importFile,
  importPreview,
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
  const [voiceListening, setVoiceListening] = useState(false);
  const speechRecRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const d = await getDashboard();
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
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        const s = await getSettings();
        setSettings(s);
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
          const { rag_hits } = await fetchRagPreview(q, 8);
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
  }, [input, rag, tab]);

  useEffect(() => {
    if (tab !== "chat") return;
    const el = chatLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [tab, chatMessages]);

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
    }));
  }, [dash]);

  const mergedForChat = useMemo(() => {
    const presetText =
      chatMode === "interview"
        ? (getInterviewPreset(interviewPresetId)?.systemAppend ?? "")
        : "";
    return mergeInterviewExtra(presetText, extraSystem);
  }, [chatMode, interviewPresetId, extraSystem]);

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
          </div>
          {apiHealth?.data_dir ? (
            <p className="health-path" title={apiHealth.data_dir}>
              数据目录：<code>{apiHealth.data_dir}</code>
            </p>
          ) : null}

          <div className="panel">
            <h2>平台分布</h2>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={platformData}>
                  <XAxis dataKey="name" stroke="#8b919d" tick={{ fill: "#8b919d", fontSize: 12 }} />
                  <YAxis stroke="#8b919d" tick={{ fill: "#8b919d", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: "#14161c", border: "1px solid #2a2e38" }}
                    labelStyle={{ color: "#e8eaef" }}
                  />
                  <Bar dataKey="value" fill="#7ee0c7" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h2>发送者（抽样）</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
              基于本地向量库中最多 {dash.social?.sample_size ?? 0} 条消息的元数据统计；无发送者列的导入会显示为「未标注」。
            </p>
            {senderData.length > 0 ? (
              <div style={{ width: "100%", height: Math.min(360, 40 + senderData.length * 28) }}>
                <ResponsiveContainer>
                  <BarChart data={senderData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" stroke="#8b919d" tick={{ fill: "#8b919d", fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      stroke="#8b919d"
                      tick={{ fill: "#8b919d", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{ background: "#14161c", border: "1px solid #2a2e38" }}
                      labelStyle={{ color: "#e8eaef" }}
                      formatter={(v: number) => [v, "条"]}
                    />
                    <Bar dataKey="value" fill="#9db4ff" radius={[0, 6, 6, 0]} />
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
              </p>
              <ul className="pair-list">
                {(dash.social?.adjacent_pairs ?? []).slice(0, 24).map((p) => (
                  <li key={`${p.a}|${p.b}`}>
                    <span className="pair-a">{p.a}</span>
                    <span className="pair-mid">↔</span>
                    <span className="pair-b">{p.b}</span>
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
          </p>
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
              <button
                type="button"
                className="primary"
                disabled={busy || !pendingImportFileRef.current}
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
                确认导入
              </button>
            </div>
          ) : null}
        </div>
      )}

      {tab === "memory" && (
        <MemoryAdmin
          onChanged={() => void refresh()}
          onToast={(s) => setToast(s)}
          onErr={(s) => setErr(s)}
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
            <p className="chat-lead">
              左侧为<strong>记忆档案</strong>：随输入实时预览检索；发送后模型流式回复时抽屉会<strong>逐条点亮</strong>。默认已预置一段开场白，你可直接改发。勾选「写入本地记忆」时，每轮你与助手的完整句子会进入向量库，与导入的聊天记录一起参与后续 RAG。快捷键：<kbd>Esc</kbd>{" "}
              停止生成；<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> 发送。
            </p>
            <label className="chat-opt">
              <input type="checkbox" checked={rag} onChange={(e) => setRag(e.target.checked)} />
              <span>启用本地向量检索（RAG）</span>
            </label>
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
              <label className="field chat-preset">
                访谈剧本（合并进系统提示，可与下方「人设」同发）
                <select
                  value={interviewPresetId}
                  onChange={(e) => setInterviewPresetId(e.target.value)}
                  aria-label="访谈剧本"
                >
                  {INTERVIEW_PRESETS.map((p) => (
                    <option key={p.id || "none"} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <span className="preset-hint">{getInterviewPreset(interviewPresetId)?.hint ?? ""}</span>
              </label>
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

          <h3 className="settings-sub">对话（Chat / 补全）</h3>
          <label className="field">
            对话模型 ID
            <input
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              placeholder="如 doubao-seed-… 或 ep-xxxx（聊天用）"
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
                await saveSettings(settings);
                setToast("设置已保存");
                const s = await getSettings();
                setSettings(s);
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
