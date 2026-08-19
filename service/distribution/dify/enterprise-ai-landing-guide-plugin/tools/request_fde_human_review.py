from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

from tools.base import LandingGuideTool


class RequestFdeHumanReviewTool(LandingGuideTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        contact = bool(tool_parameters.get("consent_to_contact", False))
        consent = {
            "consentToStore": bool(tool_parameters.get("consent_to_store", False)),
            "consentToContact": contact,
            "companyName": self.text(tool_parameters, "company_name"),
            "contactName": self.text(tool_parameters, "contact_name") if contact else "",
            "mobile": self.text(tool_parameters, "mobile") if contact else "",
            "email": self.text(tool_parameters, "email") if contact else "",
        }
        yield from self.emit(lambda: self.api().consent_and_convert(
            self.text(tool_parameters, "session_id"), self.text(tool_parameters, "session_token"), consent, self.key(tool_parameters),
        ))
