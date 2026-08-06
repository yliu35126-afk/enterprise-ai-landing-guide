from collections.abc import Generator
import secrets
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.client import LandingGuideApi, LandingGuideApiError


class LandingGuideTool(Tool):
    def api(self) -> LandingGuideApi:
        return LandingGuideApi(str(self.runtime.credentials["api_base"]))

    def emit(self, callback) -> Generator[ToolInvokeMessage]:
        try:
            yield self.create_json_message(callback())
        except LandingGuideApiError as error:
            yield self.create_json_message({"isError": True, "code": "DIFY-LANDING-API", "message": str(error)[:300]})

    @staticmethod
    def text(parameters: dict[str, Any], key: str, default: str = "") -> str:
        return str(parameters.get(key, default) or default).strip()

    @staticmethod
    def key(parameters: dict[str, Any]) -> str:
        return str(parameters.get("idempotency_key") or f"dify-{secrets.token_hex(16)}")
