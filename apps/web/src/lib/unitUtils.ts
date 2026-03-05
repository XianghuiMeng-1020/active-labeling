export function getEssaySentenceMeta(unitId?: string) {
  if (!unitId) return null;
  const m = unitId.match(/essay0*(\d+)_sentence0*(\d+)/i);
  if (!m) return null;
  return { essay: Number(m[1]), sentence: Number(m[2]) };
}
