import { useCallback, useRef, useState } from "react";
import type { RagHit } from "./api";

const STREAM_CHARS_PER_DRAWER = 36;

type Props = {
  previewHits: RagHit[];
  injectedHits: RagHit[];
  pinnedHit: RagHit | null;
  onPin: (hit: RagHit) => void;
  onClearPin: () => void;
  onInsertToInput: (hit: RagHit) => void;
  ragEnabled: boolean;
  /** 模型流式输出中，用于左侧「本轮注入」抽屉逐步点亮 */
  vaultStreaming: boolean;
  streamCharCount: number;
};

export function MemoryVault({
  previewHits,
  injectedHits,
  pinnedHit,
  onPin,
  onClearPin,
  onInsertToInput,
  ragEnabled,
  vaultStreaming,
  streamCharCount,
}: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; hit: RagHit } | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLeave = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);

  const onEnterDrawer = useCallback(
    (e: React.MouseEvent, hit: RagHit) => {
      clearLeave();
      setTip({ x: e.clientX, y: e.clientY, hit });
    },
    [clearLeave],
  );

  const onMoveDrawer = useCallback(
    (e: React.MouseEvent) => {
      setTip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
    },
    [],
  );

  const onLeaveDrawer = useCallback(() => {
    leaveTimer.current = setTimeout(() => setTip(null), 120);
  }, []);

  const injectedIds = new Set(injectedHits.map((h) => h.id));
  const nInjected = injectedHits.length;

  const streamSuffix = (kind: "injected" | "preview", index: number) => {
    if (kind !== "injected" || !vaultStreaming || nInjected <= 0) return "";
    const pulseIdx = Math.min(
      Math.floor(streamCharCount / STREAM_CHARS_PER_DRAWER),
      nInjected - 1,
    );
    if (index < pulseIdx) return " memory-drawer--stream-lit";
    if (index === pulseIdx) return " memory-drawer--stream-pulse";
    return " memory-drawer--stream-wait";
  };

  const renderRow = (hit: RagHit, kind: "injected" | "preview", index: number) => {
    const isHot = kind === "injected";
    const isPinned = pinnedHit?.id === hit.id;
    const stream = streamSuffix(kind, index);
    return (
      <div
        key={`${kind}-${hit.id}-${index}`}
        className={`memory-drawer ${isHot ? "memory-drawer--hot" : "memory-drawer--ghost"} ${isPinned ? "memory-drawer--pinned" : ""}${stream}`}
        style={{ animationDelay: `${index * 0.04}s` }}
        onMouseEnter={(e) => onEnterDrawer(e, hit)}
        onMouseMove={onMoveDrawer}
        onMouseLeave={onLeaveDrawer}
      >
        <div className="memory-drawer__tab" />
        <div className="memory-drawer__body">
          <div className="memory-drawer__meta">
            <span className="memory-drawer__platform">{hit.platform || "—"}</span>
            {hit.sender ? <span className="memory-drawer__sender">{hit.sender}</span> : null}
            {hit.ts ? <span className="memory-drawer__ts">{hit.ts}</span> : null}
            {hit.distance != null ? (
              <span className="memory-drawer__dist" title="与当前问题的向量距离（越小越近）">
                Δ {typeof hit.distance === "number" ? hit.distance.toFixed(4) : hit.distance}
              </span>
            ) : null}
          </div>
          <p
            className="memory-drawer__preview memory-drawer__preview--tap"
            title="点击将全文插入输入框"
            onClick={() => onInsertToInput(hit)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onInsertToInput(hit);
              }
            }}
            role="button"
            tabIndex={0}
          >
            {hit.preview || "（空）"}
          </p>
          <div className="memory-drawer__actions">
            <button
              type="button"
              className="memory-drawer__btn"
              onClick={(e) => {
                e.stopPropagation();
                onInsertToInput(hit);
              }}
            >
              插入输入
            </button>
            <button
              type="button"
              className="memory-drawer__btn"
              onClick={(e) => {
                e.stopPropagation();
                onPin(hit);
              }}
            >
              {isPinned ? "取消钉选" : "钉选上下文"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside className="memory-vault" aria-label="记忆档案">
      <div className="memory-vault__header">
        <h3 className="memory-vault__title">记忆档案</h3>
        <p className="memory-vault__sub">
          {ragEnabled
            ? "输入时预览检索；回复流式输出时左侧逐条点亮。点击摘要或「插入输入」写入输入框；悬停看全文。"
            : "开启「向量检索」后此处会显示相关记忆。"}
        </p>
      </div>

      {pinnedHit ? (
        <div className="memory-vault__pinned-bar">
          <span className="memory-vault__pinned-label">已钉选</span>
          <span className="memory-vault__pinned-snippet">{pinnedHit.preview}</span>
          <button type="button" className="memory-vault__pinned-clear" onClick={onClearPin}>
            清除
          </button>
        </div>
      ) : null}

      <div className="memory-vault__scroll">
        {injectedHits.length > 0 ? (
          <section className="memory-vault__section">
            <h4 className="memory-vault__section-title">
              <span className="memory-vault__pulse" /> 本轮注入模型
            </h4>
            {injectedHits.map((h, i) => renderRow(h, "injected", i))}
          </section>
        ) : null}

        {previewHits.length > 0 && ragEnabled ? (
          <section className="memory-vault__section memory-vault__section--preview">
            <h4 className="memory-vault__section-title memory-vault__section-title--dim">随输入预览</h4>
            {previewHits.map((h, i) => {
              const already = injectedIds.has(h.id);
              return (
                <div
                  key={`pv-${h.id}-${i}`}
                  className={already ? "memory-drawer-wrap memory-drawer-wrap--muted" : "memory-drawer-wrap"}
                >
                  {renderRow(h, "preview", i)}
                </div>
              );
            })}
          </section>
        ) : null}

        {!ragEnabled && injectedHits.length === 0 && previewHits.length === 0 ? (
          <div className="memory-vault__empty">等待对话或打开 RAG…</div>
        ) : null}
      </div>

      {tip ? (
        <div
          className="memory-tooltip"
          style={{
            left: Math.min(tip.x + 12, typeof window !== "undefined" ? window.innerWidth - 340 : tip.x),
            top: tip.y + 12,
          }}
          onMouseEnter={clearLeave}
          onMouseLeave={() => setTip(null)}
        >
          <div className="memory-tooltip__meta">
            {(tip.hit.platform || tip.hit.sender || tip.hit.ts) && (
              <span>
                {[tip.hit.platform, tip.hit.sender, tip.hit.ts].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <pre className="memory-tooltip__text">{tip.hit.text}</pre>
        </div>
      ) : null}
    </aside>
  );
}
