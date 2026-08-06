from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

from tools.base import LandingGuideTool


class GetAiLandingMapTool(LandingGuideTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        yield from self.emit(lambda: self.api().get_map(
            self.text(tool_parameters, "session_id"), self.text(tool_parameters, "session_token"),
        ))
