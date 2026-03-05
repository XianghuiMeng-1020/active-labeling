import { useCallback, useEffect, useRef, useState } from "react";
import { type Essay } from "../lib/essayData";
import { useI18n } from "../lib/i18n";

interface DifficultyRankingProps {
  essay: Essay;
  onSubmit: (ranking: string[]) => void;
  submitting?: boolean;
}

export function DifficultyRanking({ essay, onSubmit, submitting }: DifficultyRankingProps) {
  const { t } = useI18n();
  const [items, setItems] = useState(() =>
    essay.sentences.map((s) => ({
      unitId: s.unitId,
      label: `S${s.sentenceIndex}`,
      text: s.text
    }))
  );
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const handleDragStart = useCallback((idx: number) => {
    dragItem.current = idx;
    setDraggingIdx(idx);
  }, []);

  const handleDragEnter = useCallback((idx: number) => {
    dragOverItem.current = idx;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null) {
      setDraggingIdx(null);
      return;
    }
    const from = dragItem.current;
    const to = dragOverItem.current;
    if (from !== to) {
      setItems((prev) => {
        const next = [...prev];
        const [removed] = next.splice(from, 1);
        next.splice(to, 0, removed);
        return next;
      });
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDraggingIdx(null);
  }, []);

  const handleTouchStart = useRef<{ idx: number; y: number } | null>(null);

  const onTouchStart = useCallback((idx: number, e: React.TouchEvent) => {
    handleTouchStart.current = { idx, y: e.touches[0].clientY };
    setDraggingIdx(idx);
  }, []);

  const rankListRef = useRef<HTMLDivElement>(null);

  const onTouchMoveNative = useCallback(
    (e: TouchEvent) => {
      if (handleTouchStart.current === null) return;
      e.preventDefault();
      const touch = e.touches[0];
      const elements = document.querySelectorAll(".rank-item");
      for (let i = 0; i < elements.length; i++) {
        const rect = elements[i].getBoundingClientRect();
        if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
          dragOverItem.current = i;
          break;
        }
      }
    },
    []
  );

  useEffect(() => {
    const el = rankListRef.current;
    if (!el) return;
    el.addEventListener("touchmove", onTouchMoveNative, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMoveNative);
  }, [onTouchMoveNative]);

  const onTouchEnd = useCallback(() => {
    if (handleTouchStart.current === null) return;
    const from = handleTouchStart.current.idx;
    const to = dragOverItem.current;
    if (to !== null && from !== to) {
      setItems((prev) => {
        const next = [...prev];
        const [removed] = next.splice(from, 1);
        next.splice(to, 0, removed);
        return next;
      });
    }
    handleTouchStart.current = null;
    dragOverItem.current = null;
    setDraggingIdx(null);
  }, []);

  const moveItem = useCallback((idx: number, direction: -1 | 1) => {
    setItems((prev) => {
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  }, []);

  return (
    <div className="card ranking-card">
      <div className="ranking-header">
        <h3>{t("ranking.title")}</h3>
        <p className="ranking-hint">{t("ranking.hint")}</p>
      </div>

      <div className="essay-display" style={{ marginBottom: 16 }}>
        <div className="essay-sentences">
          {essay.sentences.map((s) => (
            <div key={s.unitId} className="essay-sentence" style={{ fontSize: 13, padding: "6px 10px" }}>
              <span className="essay-sentence-label">S{s.sentenceIndex}.</span>
              <span className="essay-sentence-text">{s.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ranking-subtitle">{t("ranking.dragInstruction")}</div>
      <div className="rank-list" ref={rankListRef}>
        {items.map((item, idx) => (
          <div
            key={item.unitId}
            className={`rank-item ${draggingIdx === idx ? "rank-item-dragging" : ""}`}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            onTouchStart={(e) => onTouchStart(idx, e)}
            onTouchEnd={onTouchEnd}
          >
            <span className="rank-position">{idx + 1}</span>
            <span className="rank-grip">⠿</span>
            <span className="rank-label">{item.label}</span>
            <span className="rank-text">{item.text.slice(0, 50)}…</span>
            <div className="rank-arrows">
              <button
                className="rank-arrow-btn"
                onClick={() => moveItem(idx, -1)}
                disabled={idx === 0}
                aria-label="Move up"
              >
                ▲
              </button>
              <button
                className="rank-arrow-btn"
                onClick={() => moveItem(idx, 1)}
                disabled={idx === items.length - 1}
                aria-label="Move down"
              >
                ▼
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn primary full-width lg"
        style={{ marginTop: 16 }}
        onClick={() => onSubmit(items.map((i) => i.unitId))}
        disabled={submitting}
      >
        {submitting ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <>{t("ranking.confirm")} →</>}
      </button>
    </div>
  );
}
