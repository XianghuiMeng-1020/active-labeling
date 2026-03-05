#!/usr/bin/env python3
"""
使用 Qwen API 批量生成 AI literacy 相关的 3-5 句短文。
每批生成 20 篇，共 1000 篇，输出到 JSONL 文件。
"""

import json
import os
import sys
import time
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    print("请先安装: pip install openai")
    sys.exit(1)

# 配置
BATCH_SIZE = 20
TOTAL_ESSAYS = int(os.environ.get("TOTAL_ESSAYS", "1000"))
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "ai_literacy_essays.jsonl"
# 可选: BASE_URL 中国=dashscope.aliyuncs.com, 新加坡=dashscope-intl, 美国=dashscope-us
BASE_URL = os.environ.get("QWEN_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
MODEL = "qwen-turbo"
DELAY_BETWEEN_BATCHES = 2  # 秒，避免触发限流
REQUEST_TIMEOUT = 120  # 秒


def get_client():
    api_key = os.environ.get("QWEN_API_KEY")
    if not api_key:
        print("错误: 请设置环境变量 QWEN_API_KEY")
        print("示例: export QWEN_API_KEY='sk-your-key'")
        sys.exit(1)
    return OpenAI(api_key=api_key, base_url=BASE_URL)


def generate_batch(client: OpenAI, batch_num: int, batch_size: int) -> list[dict]:
    """生成一批短文"""
    prompt = f"""请生成 {batch_size} 篇关于 AI literacy（人工智能素养）的英文短文。
每篇短文必须：
- 3-5 句话
- 主题围绕 AI literacy，例如：理解 AI 的能力与局限、批判性使用 AI、AI 伦理、AI 在教育/工作中的应用、数字素养与 AI 等
- 每篇内容不同，角度多样
- 语言自然、适合作为教学材料

请严格按照以下 JSON 格式输出，不要添加其他说明：
{{
  "essays": [
    {{"id": 1, "text": "第一篇文章的完整内容..."}},
    {{"id": 2, "text": "第二篇文章的完整内容..."}}
  ]
}}
"""

    messages = [
        {"role": "system", "content": "You are a helpful assistant. Output valid JSON only, no markdown or extra text."},
        {"role": "user", "content": prompt}
    ]

    response = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.8,
        timeout=REQUEST_TIMEOUT,
    )
    content = response.choices[0].message.content.strip()

    # 尝试解析 JSON（可能被 markdown 包裹）
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0].strip()
    elif "```" in content:
        content = content.split("```")[1].split("```")[0].strip()

    data = json.loads(content)
    essays = data.get("essays", [])

    # 添加全局 id（支持 START_ID 续写）
    base_id = (batch_num - 1) * batch_size + int(os.environ.get("START_ID", "1"))
    result = []
    for i, e in enumerate(essays):
        result.append({
            "id": base_id + i,
            "text": e.get("text", ""),
            "batch": batch_num,
        })
    return result


def main():
    client = get_client()
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    start_id = int(os.environ.get("START_ID", "1"))
    total_batches = (TOTAL_ESSAYS + BATCH_SIZE - 1) // BATCH_SIZE
    all_essays = []
    failed_batches = []

    print(f"开始生成 {TOTAL_ESSAYS} 篇 AI literacy 短文")
    print(f"每批 {BATCH_SIZE} 篇，共 {total_batches} 批")
    print(f"输出文件: {OUTPUT_FILE}")
    print("-" * 50)

    for batch_num in range(1, total_batches + 1):
        try:
            batch = generate_batch(client, batch_num, BATCH_SIZE)
            all_essays.extend(batch)

            # 实时写入文件
            with open(OUTPUT_FILE, "a", encoding="utf-8") as f:
                for e in batch:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")

            print(f"批次 {batch_num}/{total_batches}: 成功生成 {len(batch)} 篇 (累计 {len(all_essays)} 篇)")

            if batch_num < total_batches:
                time.sleep(DELAY_BETWEEN_BATCHES)

        except Exception as ex:
            print(f"批次 {batch_num} 失败: {ex}")
            failed_batches.append(batch_num)
            time.sleep(5)  # 失败后等待更长时间再重试

    # 若总数不足，尝试补生成
    if len(all_essays) < TOTAL_ESSAYS:
        remaining = TOTAL_ESSAYS - len(all_essays)
        print(f"\n补生成剩余 {remaining} 篇...")
        try:
            batch = generate_batch(client, total_batches + 1, remaining)
            for i, e in enumerate(batch):
                e["id"] = len(all_essays) + i + 1
            all_essays.extend(batch)
            with open(OUTPUT_FILE, "a", encoding="utf-8") as f:
                for e in batch:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")
        except Exception as ex:
            print(f"补生成失败: {ex}")

    print("-" * 50)
    print(f"完成! 共生成 {len(all_essays)} 篇短文")
    if failed_batches:
        print(f"失败批次: {failed_batches}")
    print(f"输出: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
