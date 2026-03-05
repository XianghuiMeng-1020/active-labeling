#!/usr/bin/env python3
"""
把 ai_literacy_essays.jsonl 转成 sentence-level units JSONL。
输出格式:
{"unit_id":"essay0001_sentence01","text":"...","meta_json":"{...}"}
"""

import json
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INPUT_FILE = PROJECT_ROOT / "data" / "ai_literacy_essays.jsonl"
OUTPUT_FILE = PROJECT_ROOT / "data" / "ai_literacy_sentence_units.jsonl"


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def main() -> None:
    total_units = 0
    with INPUT_FILE.open("r", encoding="utf-8") as fin, OUTPUT_FILE.open("w", encoding="utf-8") as fout:
        for line in fin:
            row = json.loads(line)
            essay_id = int(row["id"])
            sentences = split_sentences(row["text"])
            for idx, sentence in enumerate(sentences, start=1):
                unit = {
                    "unit_id": f"essay{essay_id:04d}_sentence{idx:02d}",
                    "text": sentence,
                    "meta_json": json.dumps(
                        {
                            "source": "ai_literacy",
                            "essay": essay_id,
                            "sentence": idx,
                            "sentence_total": len(sentences),
                        },
                        ensure_ascii=False,
                    ),
                }
                fout.write(json.dumps(unit, ensure_ascii=False) + "\n")
                total_units += 1

    print(f"Done. Generated {total_units} sentence-level units: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
