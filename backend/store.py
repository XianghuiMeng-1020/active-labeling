"""标注结果存储，提交后供管理员实时查看。"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime

# 内存存储（可替换为数据库）
_labeling_results: list[dict] = []
_subscribers: set[asyncio.Queue] = set()


@dataclass
class LabelingRecord:
    """单条标注记录。"""
    id: str
    prompt: str
    model: str
    result: str
    source: str  # "hku" | "qwen"
    created_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "prompt": self.prompt,
            "model": self.model,
            "result": self.result,
            "source": self.source,
            "created_at": self.created_at.isoformat(),
        }


def add_result(record: LabelingRecord) -> None:
    """写入一条标注结果并通知订阅者。"""
    data = record.to_dict()
    _labeling_results.append(data)
    for q in _subscribers:
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            pass


def get_all_results() -> list[dict]:
    """返回当前所有标注结果（供管理员 Bar Chart 等）。"""
    return list(_labeling_results)


def subscribe() -> asyncio.Queue:
    """管理员订阅实时更新，返回一个 Queue，每次有新结果会 put 一条。"""
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)
