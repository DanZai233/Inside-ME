import { useCallback, useEffect, useMemo, useState } from "react";
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
  type ChatMessage,
  type DashboardResponse,
  type UserSettings,
  chat,
  exportSkill,
  getDashboard,
  getSettings,
  importFile,
  patchProfile,
  saveSettings,
  summarizeProfile,
} from "./api";

type Tab = "dashboard" | "import" | "chat" | "settings" | "skill";

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dash, setDash] = useState<DashboardResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    api_base_url: "https://api.openai.com",
    api_key: "",
    model: "gpt-4o-mini",
    use_remote_embedding: false,
    embedding_model: "",
    embedding_ark_multimodal: false,
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [rag, setRag] = useState(true);
  const [chatMode, setChatMode] = useState<"default" | "interview">("default");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [skillName, setSkillName] = useState("my-inside-me");
  const [skillUseLlm, setSkillUseLlm] = useState(true);
  const [notes, setNotes] = useState({
    persona_summary: "",
    values_notes: "",
    fear_desire_notes: "",
  });

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
    setBusy(true);
    setErr(null);
    const next: ChatMessage[] = [...chatMessages, { role: "user", content: t }];
    setChatMessages(next);
    setInput("");
    try {
      const { reply } = await chat(next, rag, chatMode);
      setChatMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="layout">
      <header className="hero">
        <h1>中之我</h1>
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
          </div>

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
            支持 QQ TXT（含 QQ 号/邮箱标记的多行块）、微信风格 TXT（时间行 + 昵称 + 多行正文）、微博类（仅一行时间、下接多行正文，且文件中至少两条时间行）、或通用逐行（可选{" "}
            <code>[2024-01-01 12:00:00]</code> 与 <code>发送者:</code> 前缀）。
          </p>
          <input
            type="file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              setErr(null);
              try {
                const r = await importFile(f);
                setToast(`已导入 ${r.imported} 条（解析器：${r.platform}）`);
                await refresh();
              } catch (ex) {
                setErr(ex instanceof Error ? ex.message : String(ex));
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      )}

      {tab === "chat" && (
        <div className="panel">
          <h2>深度对话（RAG + 画像）</h2>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
            <input type="checkbox" checked={rag} onChange={(e) => setRag(e.target.checked)} />
            <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>启用本地向量检索（RAG）</span>
          </label>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
            <input
              type="checkbox"
              checked={chatMode === "interview"}
              onChange={(e) => setChatMode(e.target.checked ? "interview" : "default")}
            />
            <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              深度访谈模式（澄清式提问；非专业心理咨询）
            </span>
          </label>
          <div className="chat-log">
            {chatMessages.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>在设置中配置 API Key 后开始。</div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={`bubble ${m.role === "user" ? "user" : "assistant"}`}>
                <div className="role">{m.role}</div>
                {m.content}
              </div>
            ))}
          </div>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="想说点什么…" />
          <div className="row" style={{ marginTop: "0.5rem" }}>
            <button type="button" className="primary" disabled={busy} onClick={() => void sendChat()}>
              发送
            </button>
            <button type="button" className="ghost" onClick={() => setChatMessages([])}>
              清空
            </button>
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
        </div>
      )}
    </div>
  );
}
