"""
标注 LLM 调用：优先 HKU OpenAI API，失败时回退到 Qwen API。
根据用户选择的 Custom Prompt 和模型动态构造请求体并发送到对应 API。
"""
import logging
from typing import Any

import httpx

from config import (
    HKU_API_KEY,
    HKU_BASE_URL,
    HKU_API_VERSION,
    HKU_DEFAULT_DEPLOYMENT_ID,
    QWEN_API_KEY,
    QWEN_BASE_URL,
    QWEN_DEFAULT_MODEL,
)

logger = logging.getLogger(__name__)


def _build_hku_url(deployment_id: str) -> str:
    return (
        f"{HKU_BASE_URL}/deployments/{deployment_id}/chat/completions"
        f"?api-version={HKU_API_VERSION}"
    )


def _call_hku(
    messages: list[dict[str, str]],
    *,
    deployment_id: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 150,
) -> dict[str, Any]:
    """调用 HKU OpenAI API。"""
    deployment_id = deployment_id or HKU_DEFAULT_DEPLOYMENT_ID
    url = _build_hku_url(deployment_id)
    headers = {
        "Content-Type": "application/json",
        "api-key": HKU_API_KEY,
    }
    body = {
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(url, json=body, headers=headers)
        response.raise_for_status()
        return response.json()


def _call_qwen(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 150,
) -> dict[str, Any]:
    """回退：调用 Qwen (DashScope) OpenAI 兼容 API。"""
    model = model or QWEN_DEFAULT_MODEL
    url = f"{QWEN_BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {QWEN_API_KEY}",
    }
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(url, json=body, headers=headers)
        response.raise_for_status()
        return response.json()


def call_labeling_api(
    messages: list[dict[str, str]],
    *,
    deployment_id: str | None = None,
    qwen_model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 150,
) -> tuple[dict[str, Any], str]:
    """
    标注接口：先调 HKU OpenAI，失败则回退 Qwen。
    返回 (API 响应, 来源 "hku"|"qwen")。
    请求体根据前端传入的 Custom Prompt（messages）和模型动态调整。
    """
    try:
        out = _call_hku(
            messages,
            deployment_id=deployment_id,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return (out, "hku")
    except httpx.HTTPStatusError as e:
        logger.warning("HKU API failed, fallback to Qwen: %s", e)
    except Exception as e:
        logger.warning("HKU API error, fallback to Qwen: %s", e)

    out = _call_qwen(
        messages,
        model=qwen_model,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return (out, "qwen")
