import { useMemo } from "react";
import { type Essay } from "../lib/essayData";
import { useI18n } from "../lib/i18n";

interface EssayDisplayProps {
  essay: Essay;
  currentUnitId: string;
}

export function EssayDisplay({ essay, currentUnitId }: EssayDisplayProps) {
  const { t } = useI18n();

  const currentIdx = useMemo(
    () => essay.sentences.findIndex((s) => s.unitId === currentUnitId),
    [essay, currentUnitId]
  );

  return (
    <div className="essay-display">
      <div className="essay-header">
        <span className="unit-chip">
          {t("flow.essay")} {essay.essayIndex}
        </span>
      </div>
      <div className="essay-sentences">
        {essay.sentences.map((s, idx) => (
          <div
            key={s.unitId}
            className={`essay-sentence ${idx === currentIdx ? "essay-sentence-active" : ""}`}
          >
            <span className="essay-sentence-label">S{s.sentenceIndex}.</span>
            <span className="essay-sentence-text">{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
