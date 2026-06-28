<div align="center">

# MNotation

**A Learning Analytics Platform for Human–AI Collaborative Qualitative Coding**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Backend-Cloudflare%20Workers-orange)](https://workers.cloudflare.com)
[![React](https://img.shields.io/badge/Frontend-React%2019-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript)](https://www.typescriptlang.org)

[**Live Demo**](https://mnotation.pages.dev) · [**Paper**](paper/) · [**Dataset**](#dataset) · [**API Reference**](docs/API.md)

</div>

---

MNotation is an open-source, browser-based annotation platform that structures qualitative coding as a three-phase human–AI collaboration. It is designed for learning analytics researchers who need to annotate educational text corpora at scale while maintaining methodological rigour and generating fine-grained process data.

The platform supports any number of simultaneous users, requires no installation, and deploys in minutes on Cloudflare's global edge network. It integrates any OpenAI-compatible LLM and records rich behavioural traces—annotation latencies, AI accept/override decisions, and interaction events—that make the meaning-negotiation process itself an object of learning analytics inquiry.

> **Reference.** If you use MNotation in your research, please cite:
> ```
> [Citation to be added upon paper acceptance]
> ```

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Three-Phase Workflow](#three-phase-workflow)
- [Active Learning Algorithm (ED-AL v1)](#active-learning-algorithm-ed-al-v1)
- [Data Schema](#data-schema)
- [Quick Start](#quick-start)
- [Deployment](#deployment)
- [Dataset](#dataset)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Qualitative thematic coding is central to educational research but difficult to scale. MNotation addresses this by embedding LLM assistance within a structured workflow that preserves human interpretive authority and logs every decision for downstream analysis.

| Feature | Description |
|---|---|
| **Three-phase workflow** | Independent human annotation → LLM-assisted review → Active learning prioritisation |
| **Real-time dashboard** | Live label distribution charts and participant progress tracking |
| **Active learning** | ED-AL v1 algorithm selects the most uncertain and diverse segments for priority review |
| **Trace data** | Per-annotation timing (active, idle, blur), accept/override flags, interaction events |
| **Multi-LLM** | Configurable primary + fallback LLM providers (any OpenAI-compatible endpoint) |
| **Zero-install** | Browser-based; participants join via QR code or URL |
| **Configurable taxonomy** | Admin-defined label sets and prompt templates; no code changes required |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Participant Browser                 │
│     React 19 + TypeScript (Cloudflare Pages)        │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS / SSE
┌────────────────────────▼────────────────────────────┐
│              Cloudflare Worker (Hono 4.x)           │
│   REST API · Rate limiting · LLM proxy · Auth       │
├──────────────┬──────────────────┬───────────────────┤
│  Cloudflare  │ Cloudflare       │  LLM Provider     │
│  D1 (SQLite) │ Durable Objects  │  (Qwen / GPT-4o   │
│  12 tables   │ (SSE broadcast)  │   / any OAI API)  │
└──────────────┴──────────────────┴───────────────────┘
```

**Stack summary**

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 7 (mobile-first) |
| Backend | Cloudflare Workers, Hono 4.x |
| Database | Cloudflare D1 (serverless SQLite) |
| Real-time | Cloudflare Durable Objects (SSE push) |
| LLM | Any OpenAI-compatible API (default: Qwen-Plus) |
| Active learning | ED-AL v1 (Shannon entropy + k-centre greedy) |

---

## Three-Phase Workflow

### Phase 1 — Independent Human Annotation

Each participant reads text segments one at a time and assigns a label from the taxonomy by tapping or clicking. No AI information is shown. The interface records:

- `active_ms` — time the interface was in active focus
- `idle_ms` — time the interface was visible but unfocused
- `blur_count` — number of tab-switch events during annotation

A configurable minimum engagement threshold (default 800 ms) filters accidental clicks before a label is accepted.

### Phase 2 — LLM-Assisted Review

After completing Phase 1, participants see each text segment alongside the LLM's predicted label. They can:

- **Accept** the AI prediction (one tap)
- **Override** using a slide-up label selector
- **Switch prompts** between zero-shot (Prompt 1), few-shot (Prompt 2), or a custom prompt (rate-limited to 5 queries per session)

The tool logs the final accepted label, whether it differs from the AI prediction, and the decision latency.

### Phase 3 — Active Learning Prioritisation

A small subset of segments selected by the ED-AL v1 algorithm (see below) is presented for re-annotation. These are the segments where collective human uncertainty is highest and content diversity is greatest—the cases most in need of expert deliberation.

---

## Active Learning Algorithm (ED-AL v1)

ED-AL v1 selects which text segments to surface in Phase 3 using two sequential steps.

**Step 1 — Uncertainty scoring (entropy)**

For each candidate segment, the LLM is queried *N* times with temperature > 0 to sample a label distribution. [Shannon entropy](https://en.wikipedia.org/wiki/Entropy_(information_theory)) is computed over the resulting label frequencies and normalised to [0, 1]. High entropy indicates a segment where the model is uncertain—a proxy for genuine conceptual ambiguity.

```
H(x) = −∑ p(lᵢ|x) · log₂ p(lᵢ|x)
H_norm = H(x) / log₂(|L|)        where |L| = number of labels
```

**Step 2 — Diversity selection (k-centre greedy)**

From the top-*H* highest-entropy candidates, TF-IDF vectors are computed and a greedy k-centre algorithm selects *M* segments that are maximally spread in the feature space. This ensures the final selection covers different topical regions rather than clustering around a single ambiguous sentence type.

**Configurable parameters**

| Parameter | Default | Description |
|---|---|---|
| `candidate_k` | 80 | Size of the candidate pool |
| `top_h` | 40 | Number of high-entropy candidates to consider for diversity selection |
| `sample_n` | 3 | LLM samples per segment for entropy estimation |
| `active_m` | 20 | Final number of segments selected |
| `temperature` | 0.7 | LLM sampling temperature |

All parameters are adjustable through the Admin Dashboard without code changes.

---

## Data Schema

MNotation exports the following tables in CSV and JSON format.

**Core annotation tables**

| Table | Key fields | Description |
|---|---|---|
| `sessions` | `session_id`, `user_id`, `created_at`, `normal_manual_done_at`, `normal_llm_done_at` | One row per participant session |
| `manual_labels` | `session_id`, `unit_id`, `label`, `phase` | Phase 1 human annotations |
| `llm_labels` | `session_id`, `unit_id`, `llm_label`, `user_accepted_label`, `llm_mode` | Phase 2 LLM predictions and user decisions |
| `label_attempts` | `session_id`, `unit_id`, `active_ms`, `idle_ms`, `blur_count`, `is_valid` | Per-annotation behavioural traces |
| `interaction_events` | `session_id`, `event_type`, `unit_id`, `created_at` | Fine-grained UI interaction log |

**Enriched analysis views**

| View | Description |
|---|---|
| `human_vs_llm` | Per-item comparison: human label, LLM prediction, agreement flags |
| `timing_analysis` | Valid annotation attempts with full timing breakdown |
| `per_user_summary` | Per-participant aggregates: label counts, average times, completion status |
| `label_distribution_per_unit` | Per-segment label distribution across all annotators |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) ≥ 3
- A Cloudflare account (free tier is sufficient)
- An API key for an OpenAI-compatible LLM (e.g., [Qwen via DashScope](https://dashscope.aliyuncs.com))

### 1. Clone and install

```bash
git clone https://github.com/XianghuiMeng-1020/active-labeling.git
cd active-labeling

# Install Worker dependencies
cd workers/api && npm install && cd ../..

# Install frontend dependencies
cd apps/web && npm install && cd ../..
```

### 2. Configure environment variables

Create `workers/api/.dev.vars`:

```ini
QWEN_API_KEY=your_dashscope_api_key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ADMIN_TOKEN=choose-a-secure-token
MIN_ACTIVE_MS=800
```

### 3. Run locally

```bash
# Terminal 1 — Worker backend (port 8787)
cd workers/api && wrangler dev

# Terminal 2 — React frontend (port 5173)
cd apps/web && npm run dev
```

Open http://localhost:5173. Admin panel: http://localhost:5173/admin (use your `ADMIN_TOKEN`).

### 4. Seed example data

```bash
node scripts/seed-units.mjs data/seed_units.jsonl http://localhost:8787 your-admin-token
```

The `data/seed_units.jsonl` file contains 20 example text units in the required format:

```jsonl
{"unit_id": "essay01_s01", "text": "AI literacy refers to..."}
{"unit_id": "essay01_s02", "text": "Machine learning algorithms..."}
```

---

## Deployment

### Deploy the Worker

```bash
cd workers/api

# Set production secrets (one-time)
wrangler secret put QWEN_API_KEY
wrangler secret put QWEN_BASE_URL
wrangler secret put ADMIN_TOKEN

# Apply database migrations
wrangler d1 migrations apply labeling_db --remote

# Deploy
wrangler deploy
```

### Deploy the frontend (Cloudflare Pages)

1. In the Cloudflare Pages dashboard, connect your repository.
2. Set the build command to `npm run build` and the output directory to `dist`.
3. Add the environment variable `VITE_API_BASE` pointing to your deployed Worker URL.

For a full walkthrough, see [docs/API.md](docs/API.md).

---

## Dataset

The dataset collected during the March 2026 AI Literacy Annotation Workshop (69 active participants, 15 text segments, 865 annotation decisions) will be deposited on OSF upon paper acceptance.

**Data contents**

- 702 valid manual annotations with per-annotation timing
- 555 human–LLM label comparisons (Phase 2)
- 4,253 fine-grained interaction events
- 18 post-session survey responses
- Participant summary and label distribution tables

For data field definitions, see [docs/DATA.md](docs/DATA.md).

---

## Admin Dashboard

Navigate to `/admin/login` and enter your `ADMIN_TOKEN`.

| Page | Function |
|---|---|
| `/admin/dashboard` | Live annotation progress charts, participant table, freeze display for discussion |
| `/admin/config` | Edit label taxonomy and LLM prompt templates |
| `/admin/units` | Import text units via JSONL paste |
| `/admin/al` | Trigger ED-AL v1, monitor active learning job status |

**Data export**

```bash
# CSV export (all tables)
curl "https://your-worker.workers.dev/api/admin/export?format=csv" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -o export.zip
```

---

## Security

- All `/api/admin/*` endpoints require `Authorization: Bearer ADMIN_TOKEN`.
- The LLM API key is stored only in the Worker environment; the frontend has zero access to it.
- Participant routes (`/user/*`) have no administrative entry points.
- Custom prompts are rate-limited to 5 requests per session server-side.

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

---

## Contributing

Contributions are welcome. Please open an issue before submitting a pull request for significant changes.

**Planned features**

- [ ] Expose ED-AL uncertainty scores in the Phase 3 UI for annotator transparency
- [ ] Open coding mode (participant-defined categories)
- [ ] Multi-session longitudinal tracking and inter-session reliability reports
- [ ] Multi-coder agreement dashboard (human–human vs. human–LLM comparison)

---

## License

[MIT](LICENSE) © 2026 The MNotation Authors
