# Prompt Training Log (Page2 Prompt1/Prompt2)

## Goal
- Temporarily switch to Qwen-only inference for local dev.
- Tune Page2 prompts:
  - `prompt1`: zero-shot
  - `prompt2`: few-shot
- Focus on sentence-level labeling stability for current taxonomy:
  - `POSITIVE`, `NEGATIVE`, `NEUTRAL`, `QUESTION`, `UNKNOWN`

## Environment Setup
- Enabled Qwen-only mode via `.dev.vars`:
  - `LLM_PROVIDER=qwen`
  - `QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
- Fixed JSX compile error in `UserStartPage.tsx` by replacing raw `->` with JSX-safe text.

## Training Dataset (Quick Eval Slice)
- File: `data/ai_literacy_6.jsonl`
- 6 sentence-level units:
  - `essay001_sentence01..03`
  - `essay002_sentence01..03`

## Iteration 1
- Updated prompts through `POST /api/admin/prompts/set`.
- Evaluation method:
  - For each unit, call `/api/llm/run` with `mode=prompt1` and `mode=prompt2`.
  - Compare label agreement between prompt1 and prompt2.
- Result:
  - Agreement: `5/6`
  - One mismatch on `essay002_sentence03`:
    - Prompt1: `POSITIVE`
    - Prompt2: `NEUTRAL`

## Iteration 2 (Final)
- Refined zero-shot and few-shot:
  - Narrowed `POSITIVE/NEGATIVE` to explicit **subjective sentiment** only.
  - Clarified that analytical/recommendation statements default to `NEUTRAL`.
  - Added direct few-shot example:
    - `"Developing this awareness is key to making informed decisions." -> NEUTRAL`
- Re-ran the same 6-unit evaluation.
- Final result:
  - Agreement: `6/6 (100%)`

## Final Prompt1 (Zero-shot)
```text
Task: Classify one sentence into exactly one label from the allowed taxonomy.
Decision rules (strict priority):
1) If the sentence is a question or asks for clarification/information, output QUESTION.
2) Else if it clearly expresses personal praise, support, gratitude, satisfaction, or other subjective positive emotion, output POSITIVE.
3) Else if it clearly expresses complaint, criticism, frustration, opposition, or other subjective negative emotion, output NEGATIVE.
4) Else output NEUTRAL for factual, analytical, instructional, or general recommendation statements without explicit personal sentiment.
5) If still ambiguous, output UNKNOWN.
Keep reasoning internal and only return the final JSON label.
```

## Final Prompt2 (Few-shot)
```text
Few-shot guide for sentence-level labeling. Follow exactly the same label space and output format.

Examples:
- "I appreciate your detailed feedback." -> POSITIVE
- "Thank you for extending office hours." -> POSITIVE
- "This assignment is too difficult for beginners." -> NEGATIVE
- "I am frustrated by repeated platform crashes." -> NEGATIVE
- "Can you explain the grading criteria again?" -> QUESTION
- "Why was my submission marked late?" -> QUESTION
- "AI literacy helps students evaluate model outputs critically." -> NEUTRAL
- "Developing this awareness is key to making informed decisions." -> NEUTRAL
- "The session starts at 9 AM tomorrow." -> NEUTRAL

Now classify the input sentence into one label with the same rules:
Priority: QUESTION > explicit subjective sentiment (POSITIVE/NEGATIVE) > NEUTRAL > UNKNOWN.
Return JSON only.
```

## Notes
- This log records prompt-engineering training (rule + example tuning), not model weight fine-tuning.
- For better reliability, next step is to evaluate on a larger labeled validation set (at least 100+ sentences) and track per-label precision/recall.
