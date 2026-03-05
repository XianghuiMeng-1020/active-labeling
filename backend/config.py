"""配置：API Key 与端点。"""
import os
from pathlib import Path

from dotenv import load_dotenv

_env = Path(__file__).resolve().parent / ".env"
load_dotenv(_env)

# HKU OpenAI API
HKU_API_KEY = os.getenv("HKU_API_KEY", "")
HKU_BASE_URL = "https://api.hku.hk/openai"
HKU_API_VERSION = "2025-01-01-preview"
HKU_DEFAULT_DEPLOYMENT_ID = os.getenv("HKU_DEFAULT_DEPLOYMENT_ID", "gpt-4.1-mini")

# Qwen 回退 API（DashScope OpenAI 兼容）
QWEN_API_KEY = os.getenv("QWEN_API_KEY", "")
QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
QWEN_DEFAULT_MODEL = os.getenv("QWEN_DEFAULT_MODEL", "qwen-plus")
