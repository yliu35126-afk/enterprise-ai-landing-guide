from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

from tools.base import LandingGuideTool


class CreateAiLandingSessionTool(LandingGuideTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        yield from self.emit(lambda: self.api().create(
            self.text(tool_parameters, "external_session_id"),
            self.text(tool_parameters, "mode"),
            self.text(tool_parameters, "campaign_code"),
        ))
