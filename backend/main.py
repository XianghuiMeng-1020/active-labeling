"""
标注服务后端：
- Custom Prompt 请求 → 调用 HKU API，失败则回退 Qwen，并写入存储与实时推送给管理员
- 管理员通过 SSE 实时接收标注结果，可刷新 Bar Chart
"""
import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from config import HKU_DEFAULT_DEPLOYMENT_ID, QWEN_DEFAULT_MODEL
from llm_client import call_labeling_api
from store import LabelingRecord, add_result, get_all_results, subscribe, unsubscribe

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------- 请求/响应模型 ----------
class ChatMessage(BaseModel):
    role: str = "user"
    content: str


class CustomPromptRequest(BaseModel):
    """前端 Custom Prompt 请求体（根据用户选择的 prompt 与模型动态调整）。"""
    messages: list[ChatMessage] = Field(..., description="用户选择的 Custom Prompt 转为 messages")
    deployment_id: str | None = Field(default=None, description="HKU 部署/模型，如 gpt-4.1-mini")
    qwen_model: str | None = Field(default=None, description="回退时使用的 Qwen 模型")
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=150, ge=1, le=4096)


# ---------- App ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # 关闭时清理


app = FastAPI(title="Active Labeling API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _messages_to_list(messages: list[ChatMessage]) -> list[dict[str, str]]:
    return [{"role": m.role, "content": m.content} for m in messages]


def _extract_content(response: dict) -> str:
    """从 OpenAI 兼容的 chat completions 响应中取出回复文本。"""
    try:
        choices = response.get("choices") or []
        if choices and len(choices) > 0:
            msg = choices[0].get("message") or {}
            return (msg.get("content") or "").strip()
    except (IndexError, KeyError, TypeError):
        pass
    return ""


@app.post("/api/chat/custom")
async def custom_prompt(req: CustomPromptRequest):
    """
    Custom Prompt 标注接口。
    后台自动选择 HKU 或 Qwen API，返回标注结果，并写入存储、实时推送给管理员。
    """
    messages = _messages_to_list(req.messages)
    if not messages:
        raise HTTPException(status_code=400, detail="messages 不能为空")

    # 先尝试 HKU，失败则回退 Qwen
    try:
        raw, source = call_labeling_api(
            messages,
            deployment_id=req.deployment_id or HKU_DEFAULT_DEPLOYMENT_ID,
            qwen_model=req.qwen_model or QWEN_DEFAULT_MODEL,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
    except Exception as e:
        logger.exception("Labeling API failed")
        raise HTTPException(status_code=502, detail=f"标注服务暂时不可用: {e}") from e

    content = _extract_content(raw)

    record = LabelingRecord(
        id=str(uuid.uuid4()),
        prompt=messages[-1]["content"] if messages else "",
        model=req.deployment_id or HKU_DEFAULT_DEPLOYMENT_ID,
        result=content,
        source=source,
    )
    add_result(record)

    return {
        "id": record.id,
        "result": content,
        "source": source,
        "created_at": record.created_at.isoformat(),
    }


@app.get("/api/admin/results")
async def admin_get_results():
    """管理员获取当前全部标注结果（用于 Bar Chart 等）。"""
    return {"results": get_all_results()}


@app.get("/api/admin/stream")
async def admin_stream():
    """
    管理员端 SSE：用户提交标注后实时推送新记录。
    前端用 EventSource('/api/admin/stream') 即可收到新数据并刷新 Bar Chart。
    """
    queue = subscribe()

    async def event_generator():
        try:
            # 先发一条快照，再只推送新记录
            yield {"data": json.dumps({"type": "snapshot", "results": get_all_results()})}
            while True:
                data = await queue.get()
                yield {"data": json.dumps({"type": "append", "result": data})}
        except asyncio.CancelledError:
            pass
        finally:
            unsubscribe(queue)

    return EventSourceResponse(event_generator())


@app.get("/admin")
async def admin_page():
    """管理员界面：实时查看标注结果与 Bar Chart。"""
    admin_html = Path(__file__).resolve().parent / "static" / "admin.html"
    if not admin_html.exists():
        raise HTTPException(status_code=404, detail="Admin page not found")
    return FileResponse(admin_html)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
