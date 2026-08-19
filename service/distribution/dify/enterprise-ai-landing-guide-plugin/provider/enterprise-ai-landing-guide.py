from typing import Any
from urllib.parse import urlparse

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from tools.client import LandingGuideApi


class EnterpriseAiLandingGuideProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            api_base = str(credentials.get("api_base", "")).strip().rstrip("/")
            parsed = urlparse(api_base)
            if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
                raise ValueError("生产API根地址必须使用HTTPS")
            result = LandingGuideApi(api_base).health()
            if result.get("status") != "ok":
                raise ValueError("健康检查未返回ok")
        except Exception as error:
            raise ToolProviderCredentialValidationError(str(error)[:300]) from error
