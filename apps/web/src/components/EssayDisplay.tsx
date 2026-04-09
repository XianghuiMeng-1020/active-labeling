import { useMemo } from "react";
import { type Essay, getSentenceText } from "../lib/essayData";
import { useI18n } from "../lib/i18n";

export type DifficultyLevel = "Easy" | "Medium" | "Hard";

interface EssayDisplayProps {
  essay: Essay;
  currentUnitId: string;
  labelsByUnitId?: Record<string, string>;
  /** When set, show difficulty after S (e.g. S2 easy) when sentence has no label */
  difficultyByUnitId?: Record<string, DifficultyLevel>;
  /** When true, highlight all labeled tags instead of highlighting the current sentence */
  highlightAllLabeled?: boolean;
}

export function EssayDisplay({ essay, currentUnitId, labelsByUnitId, difficultyByUnitId, highlightAllLabeled }: EssayDisplayProps) {
  const { t, locale, labelText } = useI18n();

  const currentIdx = useMemo(
    () => essay.sentences.findIndex((s) => s.unitId === currentUnitId),
    [essay, currentUnitId]
  );

  const difficultyText = (d: DifficultyLevel) =>
    d === "Easy" ? t("flow.difficultyEasy") : d === "Medium" ? t("flow.difficultyMedium") : t("flow.difficultyHard");

  return (
    <div className="essay-display">
      <div className="essay-header">
        <span className="unit-chip">
          {t("flow.essay")} {essay.essayIndex}
        </span>
      </div>
      <div className="essay-flow">
        {essay.sentences.map((s, idx) => {
          const hasLabel = !!labelsByUnitId?.[s.unitId];
          const difficulty = difficultyByUnitId?.[s.unitId];
          const isActive = highlightAllLabeled ? false : idx === currentIdx;
          const tagSuffix = hasLabel
            ? ` · ${labelText(labelsByUnitId![s.unitId])}`
            : difficulty
              ? ` ${difficultyText(difficulty)}`
              : "";
          return (
            <span
              key={s.unitId}
              className={`essay-flow-sentence ${isActive ? "essay-flow-active" : ""}`}
            >
              <span className={`essay-flow-tag ${highlightAllLabeled && hasLabel ? "essay-flow-tag-labeled" : ""}`}>
                S{s.sentenceIndex}
                {tagSuffix}
              </span>
              {getSentenceText(s, locale)}
              {idx < essay.sentences.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
