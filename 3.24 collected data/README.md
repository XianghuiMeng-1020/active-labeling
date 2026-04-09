# 3.24 Workshop Collected Data

Real user data collected on **March 24, 2026** from an AI Literacy sentence-level thematic coding workshop.

## Overview

| Metric | Value |
|--------|-------|
| Total Sessions | 119 |
| Unique Users | 112 |
| Time Range (UTC) | 05:05 – 09:17 |
| Completed Manual Phase | 63 (53%) |
| Completed LLM Phase | 34 (29%) |
| Survey Responses | 18 |

## Task Description

Participants annotated 15 sentences (from 3 essays about AI literacy) with one of 6 thematic codes:
- **CODE** – Short definitions / terminology
- **EXPLANATION** – Explains AI / AI literacy concepts
- **EVALUATION** – Assesses AI reliability, risks, limitations
- **RESPONSIBILITY** – Ethics, fairness, safety, accountability
- **APPLICATION** – Practical use of AI literacy
- **IMPLICATION** – Broader consequences, future significance

Each user went through two phases:
1. **Manual labeling** – Read each sentence and select a label
2. **LLM-assisted labeling** – Review LLM predictions and accept or override

## File Descriptions

### Raw Tables

| File | Rows | Description |
|------|------|-------------|
| `sessions.csv/json` | 119 | User sessions with IDs, timestamps, completion status |
| `units.csv/json` | 15 | The 15 sentences (text units) used for annotation |
| `assignments.csv/json` | 4,165 | Task assignment records (which units assigned to which sessions) |
| `manual_labels.csv/json` | 1,020 | Human annotations (session_id, unit_id, phase, label) |
| `llm_labels.csv/json` | 712 | LLM predictions + user-accepted final labels |
| `label_attempts.csv/json` | 1,568 | Per-annotation timing: active_ms, hidden_ms, idle_ms, blur_count, etc. |
| `interaction_events.csv/json` | 4,253 | Fine-grained UI interaction events (clicks, hovers, focus changes) |
| `ranking_submissions.csv/json` | 197 | User-submitted difficulty rankings of essays |
| `survey_responses.csv/json` | 18 | Post-task survey (Likert + open-ended questions) |
| `page_views.csv/json` | 690 | Page-level time tracking (enter/leave timestamps) |
| `taxonomy_labels.csv/json` | 7 | Label taxonomy definition |
| `prompts.csv/json` | 2 | LLM prompt templates (prompt1, prompt2) |

### Enriched Analysis Views

| File | Rows | Description |
|------|------|-------------|
| `labels_merged.csv/json` | 1,147 | Joined view: human label + LLM label + sentence text + user_id |
| `human_vs_llm.csv/json` | 712 | Per-item human vs LLM comparison with agreement flags |
| `timing_analysis.csv/json` | 776 | Valid manual attempts with full timing breakdown |
| `per_user_summary.csv/json` | 119 | Per-user summary: label counts, avg times, completion status |
| `label_distribution_per_unit.csv/json` | 74 | Per-sentence label distribution across all annotators |
| `page_time_per_user.csv/json` | 690 | Per-user page dwell time |

### Metadata

| File | Description |
|------|-------------|
| `_export_metadata.json` | Export timestamp, filter criteria, table summary |

## Key Statistics

- **Human–LLM Agreement**: 31.7% (226/712)
- **LLM Override Rate**: Only 5.5% of accepted LLM labels were modified by users
- **Manual Labeling Time**: Avg 12.4s/sentence (8.0s active, 3.7s idle)
- **Label Distribution**: EXPLANATION (274) > EVALUATION (240) > APPLICATION (212) > RESPONSIBILITY (154) > IMPLICATION (140)

## Data Format

- All CSV files use comma-separated values with header row
- All JSON files contain arrays of objects
- Timestamps are ISO 8601 (UTC)
- Epoch timestamps are in milliseconds
