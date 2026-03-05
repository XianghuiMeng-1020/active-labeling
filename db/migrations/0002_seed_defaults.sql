-- AI literacy theme codes (open-box default); admin can override via Config.
INSERT OR IGNORE INTO taxonomy_labels(label, description, ordering) VALUES
('EXPLANATION', 'Explains AI, AI literacy, or related concepts', 0),
('EVALUATION', 'Assesses AI reliability, value, risks, or limitations', 1),
('RESPONSIBILITY', 'Refers to ethical, fair, safe, and accountable AI use', 2),
('APPLICATION', 'Describes the use of AI literacy in practical contexts', 3),
('IMPLICATION', 'Highlights broader consequences or future significance', 4),
('UNKNOWN', 'Fallback label for parser mismatch', 5);

INSERT OR IGNORE INTO prompts(prompt_key, prompt_text, version, updated_at) VALUES
(
  'prompt1',
  'Task: Classify one sentence into exactly one theme code: EXPLANATION, EVALUATION, RESPONSIBILITY, APPLICATION, or IMPLICATION.
Decision priority:
1) RESPONSIBILITY: ethics, fairness, safety, accountability, governance, misuse prevention, or clear normative guidance.
2) EVALUATION: judging reliability, strengths/weaknesses, risks, limits, trustworthiness, comparison.
3) APPLICATION: concrete use in school/work/life, implementation, workflow, practice.
4) IMPLICATION: broad impact, long-term effects, societal/future significance, policy-level consequence.
5) EXPLANATION: definitions, concepts, how AI/AI literacy works, neutral conceptual description.
If multiple themes appear, choose the dominant communicative intent of the sentence. Return JSON only: {"label":"<ONE_CODE>"}.',
  1,
  CURRENT_TIMESTAMP
),
(
  'prompt2',
  'You are a sentence-level thematic classifier for AI literacy texts. Output one code only: EXPLANATION, EVALUATION, RESPONSIBILITY, APPLICATION, IMPLICATION.

Examples:
- "AI literacy means understanding how AI systems are trained and where they can fail." -> EXPLANATION
- "AI can make errors, especially in complex or ambiguous situations." -> EVALUATION
- "This chatbot is helpful but still unreliable for high-stakes decisions." -> EVALUATION
- "Students should verify AI answers and avoid sharing private data." -> RESPONSIBILITY
- "Organizations must document model decisions to ensure accountability." -> RESPONSIBILITY
- "Teachers can use AI tools to draft lesson plans and adapt exercises." -> APPLICATION
- "Developing this awareness is key to making informed decisions." -> APPLICATION
- "Widespread AI adoption may reshape future job roles and civic participation." -> IMPLICATION
- "Overreliance on AI could weaken independent critical thinking over time." -> IMPLICATION

Rule for ties: RESPONSIBILITY > EVALUATION > APPLICATION > IMPLICATION > EXPLANATION.
Return JSON only: {"label":"<ONE_CODE>"}.',
  1,
  CURRENT_TIMESTAMP
);
