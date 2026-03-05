"""
验证 HKU API Key 是否可成功调用。
在 backend 目录下运行: python test_hku_api.py
"""
import sys
from pathlib import Path

# 确保能导入 config、llm_client
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import HKU_API_KEY, HKU_DEFAULT_DEPLOYMENT_ID
from llm_client import _call_hku


def main():
    if not HKU_API_KEY or HKU_API_KEY == "your_hku_api_key_here":
        print("[FAIL] HKU_API_KEY not set. Add it to .env")
        return 1

    print(f"Deployment: {HKU_DEFAULT_DEPLOYMENT_ID}")
    print("Calling HKU API...")

    try:
        result = _call_hku(
            [{"role": "user", "content": "Hello! Reply with one short sentence."}],
            deployment_id=HKU_DEFAULT_DEPLOYMENT_ID,
            temperature=0.7,
            max_tokens=80,
        )
        content = (result.get("choices") or [{}])[0].get("message", {}).get("content", "")
        print("[OK] HKU API call succeeded")
        print("Reply:", content.strip() or "(empty)")
        return 0
    except Exception as e:
        print("[FAIL] HKU API call failed:", e)
        if hasattr(e, "response") and e.response is not None:
            try:
                body = e.response.text
                if len(body) > 500:
                    body = body[:500] + "..."
                print("Response:", body)
            except Exception:
                pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
