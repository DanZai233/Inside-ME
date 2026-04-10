import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type RagHit,
  browseMemory,
  deleteMemoryIds,
  downloadBackup,
  patchMemoryItem,
} from "./api";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, needle }: { text: string; needle: string }) {
  const q = needle.trim();
  const nodes = useMemo(() => {
    if (!q) return [{ i: 0, h: false, t: text }];
    try {
      const re = new RegExp(`(${escapeRegExp(q)})`, "gi");
      const parts = text.split(re);
      return parts.map((p, i) => ({
        i,
        h: p.toLowerCase() === q.toLowerCase(),
        t: p,
      }));
    } catch {
      return [{ i: 0, h: false, t: text }];
    }
  }, [text, q]);

  return (
    <>
      {nodes.map((n) =>
        n.h ? (
          <mark key={n.i} className="memory-admin__hl">
            {n.t}
          </mark>
        ) : (
          <span key={n.i}>{n.t}</span>
        ),
      )}
    </>
  );
}

export function MemoryAdmin({
  onChanged,
  onToast,
  onErr,
}: {
  onChanged: () => void;
  onToast: (s: string) => void;
  onErr: (s: string) => void;
}) {
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [tsFrom, setTsFrom] = useState("");
  const [tsTo, setTsTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 40;
  const [items, setItems] = useState<RagHit[]>([]);
  const [browseMeta, setBrowseMeta] = useState<{ scan_capped?: boolean; total_matching?: number | null }>({});
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDoc, setEditDoc] = useState("");
  const [editSender, setEditSender] = useState("");
  const [editPlatform, setEditPlatform] = useState("");
  const [editTs, setEditTs] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await browseMemory({
        limit,
        offset,
        platform: platform.trim() || undefined,
        q: q.trim() || undefined,
        ts_from: tsFrom.trim() || undefined,
        ts_to: tsTo.trim() || undefined,
      });
      setItems(res.items);
      setBrowseMeta({
        scan_capped: res.scan_capped,
        total_matching: res.total_matching,
      });
    } catch (e) {
      onErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [q, platform, tsFrom, tsTo, offset, onErr]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const onDelete = async () => {
    if (selected.size === 0) {
      onToast("请先勾选要删除的条目");
      return;
    }
    setBusy(true);
    try {
      const { deleted } = await deleteMemoryIds([...selected]);
      setSelected(new Set());
      setEditingId(null);
      onToast(`已删除 ${deleted} 条`);
      await load();
      onChanged();
    } catch (e) {
      onErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (h: RagHit) => {
    setEditingId(h.id);
    setEditDoc(h.text || "");
    setEditSender(h.sender || "");
    setEditPlatform(h.platform || "");
    setEditTs(h.ts || "");
  };

  const closeEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      await patchMemoryItem({
        id: editingId,
        document: editDoc,
        sender: editSender,
        platform: editPlatform,
        ts: editTs,
      });
      onToast("已保存修改");
      closeEdit();
      await load();
      onChanged();
    } catch (e) {
      onErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const hasNextPage = items.length >= limit;
  const tsActive = Boolean(tsFrom.trim() || tsTo.trim());
  const totalHint =
    tsActive && typeof browseMeta.total_matching === "number"
      ? `本条件共约 ${browseMeta.total_matching} 条（当前页 ${items.length} 条）`
      : null;

  return (
    <div className="panel memory-admin">
      <h2>记忆库</h2>
      <p className="memory-admin__lead">
        关键词为正文<strong>不区分大小写</strong>子串；可填<strong>时间范围</strong>（按元数据里的记录时间解析，无时间字段的条目在时间筛选下会隐藏）。命中词在列表中<strong>高亮</strong>。
        {tsActive ? " 时间筛选时最多扫描库内 5000 条再过滤，见下方提示。" : ""}
      </p>
      {browseMeta.scan_capped ? (
        <p className="memory-admin__warn">已达到扫描上限，结果可能不完整；请缩小平台/关键词/时间范围。</p>
      ) : null}
      {totalHint ? <p className="memory-admin__total">{totalHint}</p> : null}
      <div className="memory-admin__toolbar">
        <label className="field memory-admin__field">
          关键词
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="正文子串" />
        </label>
        <label className="field memory-admin__field">
          平台
          <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="可选" />
        </label>
        <label className="field memory-admin__field">
          时间起
          <input
            value={tsFrom}
            onChange={(e) => setTsFrom(e.target.value)}
            placeholder="如 2024-01-01"
          />
        </label>
        <label className="field memory-admin__field">
          时间止
          <input value={tsTo} onChange={(e) => setTsTo(e.target.value)} placeholder="如 2024-12-31" />
        </label>
        <button type="button" className="ghost" disabled={busy || offset === 0} onClick={() => setOffset((o) => Math.max(0, o - limit))}>
          上一页
        </button>
        <button type="button" className="ghost" disabled={busy || !hasNextPage} onClick={() => setOffset((o) => o + limit)}>
          下一页
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void load()}>
          刷新
        </button>
        <button type="button" className="ghost danger-outline" disabled={busy || selected.size === 0} onClick={() => void onDelete()}>
          删除选中
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => {
            void downloadBackup()
              .then(() => onToast("已开始下载备份 zip"))
              .catch((e) => onErr(e instanceof Error ? e.message : String(e)));
          }}
        >
          下载数据备份
        </button>
      </div>
      <ul className="memory-admin__list">
        {items.map((h) => (
          <li key={h.id} className="memory-admin__row">
            <label className="memory-admin__check">
              <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggle(h.id)} />
            </label>
            <div className="memory-admin__body">
              {editingId === h.id ? (
                <div className="memory-admin__editor">
                  <label className="field memory-admin__editor-field">
                    正文
                    <textarea rows={6} value={editDoc} onChange={(e) => setEditDoc(e.target.value)} />
                  </label>
                  <div className="memory-admin__editor-row">
                    <label className="field memory-admin__editor-inline">
                      平台
                      <input value={editPlatform} onChange={(e) => setEditPlatform(e.target.value)} />
                    </label>
                    <label className="field memory-admin__editor-inline">
                      发送者
                      <input value={editSender} onChange={(e) => setEditSender(e.target.value)} />
                    </label>
                    <label className="field memory-admin__editor-inline">
                      时间
                      <input value={editTs} onChange={(e) => setEditTs(e.target.value)} placeholder="ISO 或任意文本" />
                    </label>
                  </div>
                  <div className="memory-admin__editor-actions">
                    <button type="button" className="primary" disabled={busy} onClick={() => void saveEdit()}>
                      保存
                    </button>
                    <button type="button" className="ghost" disabled={busy} onClick={closeEdit}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="memory-admin__meta">
                    <span>{h.platform || "—"}</span>
                    {h.sender ? <span>{h.sender}</span> : null}
                    {h.ts ? <span>{h.ts}</span> : null}
                    <button type="button" className="memory-admin__edit-btn" onClick={() => openEdit(h)}>
                      编辑
                    </button>
                  </div>
                  <p className="memory-admin__text">
                    <HighlightedText text={h.preview || h.text.slice(0, 280)} needle={q} />
                  </p>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {items.length === 0 && !busy ? <p className="memory-admin__empty">暂无匹配条目。</p> : null}
    </div>
  );
}
