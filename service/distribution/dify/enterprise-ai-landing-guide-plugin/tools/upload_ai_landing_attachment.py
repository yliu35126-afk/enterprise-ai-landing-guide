from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

from tools.base import LandingGuideTool


class UploadAiLandingAttachmentTool(LandingGuideTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        content = self.text(tool_parameters, "text_content")[:20000]
        yield from self.emit(lambda: self.api().upload_text(
            self.text(tool_parameters, "session_id"), self.text(tool_parameters, "session_token"),
            self.text(tool_parameters, "filename", "dify-note.txt"), content, self.key(tool_parameters),
        ))
