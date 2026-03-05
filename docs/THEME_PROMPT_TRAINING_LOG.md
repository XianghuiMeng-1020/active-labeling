# Theme Prompt Engineering Log

## Target Theme Codes

- `EXPLANATION`: Explains AI, AI literacy, or related concepts
- `EVALUATION`: Assesses AI reliability, value, risks, or limitations
- `RESPONSIBILITY`: Refers to ethical, fair, safe, and accountable AI use
- `APPLICATION`: Describes the use of AI literacy in practical contexts
- `IMPLICATION`: Highlights broader consequences or future significance

## What Was Updated

1. Updated backend taxonomy via `POST /api/admin/taxonomy/set` to the 5 theme codes above.
2. Re-trained prompt templates:
   - `prompt1` = zero-shot rule-based classifier
   - `prompt2` = few-shot example-based classifier
3. Updated frontend multilingual label mapping and locale-based default prompt templates.

## Prompt Engineering Method

### Iteration 1

- Added initial decision hierarchy:
  `RESPONSIBILITY > EVALUATION > APPLICATION > IMPLICATION > EXPLANATION`
- Added few-shot examples for each theme.
- Quick eval on `data/ai_literacy_6.jsonl`:
  - Agreement between prompt1 and prompt2: `4/6 (66.67%)`
  - Main conflicts:
    - `EVALUATION` vs `EXPLANATION`
    - `APPLICATION` vs `IMPLICATION`

### Iteration 2 (Final)

- Refined boundaries:
  - `EVALUATION`: explicit quality/reliability/risk judgment about AI outputs/tools
  - `APPLICATION`: concrete action/decision usage in practical scenarios
  - `IMPLICATION`: broader societal or long-term effect beyond a single task
  - `RESPONSIBILITY`: ethics/safety/accountability + normative safe-use guidance
- Added targeted few-shot examples for ambiguous pairs.
- Re-eval result:
  - Agreement: `6/6 (100%)`

## Final Zero-shot Prompt (`prompt1`)

```text
Task: Classify one sentence into exactly one theme code: EXPLANATION, EVALUATION, RESPONSIBILITY, APPLICATION, or IMPLICATION.
Decision priority:
1) RESPONSIBILITY: ethics, fairness, safety, accountability, governance, misuse prevention, or clear normative guidance.
2) EVALUATION: judging reliability, strengths/weaknesses, risks, limits, trustworthiness, comparison.
3) APPLICATION: concrete use in school/work/life, implementation, workflow, practice.
4) IMPLICATION: broad impact, long-term effects, societal/future significance, policy-level consequence.
5) EXPLANATION: definitions, concepts, how AI/AI literacy works, neutral conceptual description.
If multiple themes appear, choose the dominant communicative intent of the sentence. Return JSON only: {"label":"<ONE_CODE>"}.
```

## Final Few-shot Prompt (`prompt2`)

```text
You are a sentence-level thematic classifier for AI literacy texts. Output one code only: EXPLANATION, EVALUATION, RESPONSIBILITY, APPLICATION, IMPLICATION.

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
Return JSON only: {"label":"<ONE_CODE>"}.
```

