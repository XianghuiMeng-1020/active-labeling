import { useMemo } from "react";
import { type Essay, getSentenceText } from "../lib/essayData";
import { useI18n } from "../lib/i18n";

interface EssayDisplayProps {
  essay: Essay;
  currentUnitId: string;
  labelsByUnitId?: Record<string, string>;
}

export function EssayDisplay({ essay, currentUnitId, labelsByUnitId }: EssayDisplayProps) {
  const { t, locale, labelText } = useI18n();

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
      <div className="essay-flow">
        {essay.sentences.map((s, idx) => (
          <span
            key={s.unitId}
            className={`essay-flow-sentence ${idx === currentIdx ? "essay-flow-active" : ""}`}
          >
            <span className="essay-flow-tag">
              S{s.sentenceIndex}
              {labelsByUnitId?.[s.unitId] ? ` · ${labelText(labelsByUnitId[s.unitId])}` : ""}
            </span>
            {getSentenceText(s, locale)}
            {idx < essay.sentences.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
