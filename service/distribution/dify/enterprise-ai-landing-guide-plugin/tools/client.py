from __future__ import annotations

import json
import secrets
import urllib.error
import urllib.request
from typing import Any


class LandingGuideApiError(RuntimeError):
    pass


class LandingGuideApi:
    prefix = "/api/public/clawhive/v1"

    def __init__(self, base_url: str, timeout: float = 35.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def request(self, method: str, path: str, body: dict[str, Any] | bytes | None = None,
                token: str = "", idempotency_key: str = "", content_type: str = "application/json") -> dict[str, Any]:
        headers = {"Accept": "application/json", "User-Agent": "enterprise-ai-landing-guide-dify/1.2.0"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        data = None
        if isinstance(body, bytes):
            data = body
            headers["Content-Type"] = content_type
        elif body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(f"{self.base_url}{self.prefix}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            try:
                payload = json.loads(error.read().decode("utf-8"))
            except Exception:
                payload = {}
            raise LandingGuideApiError(f"{payload.get('code', 'EXT-HTTP')}: {payload.get('message', '请求失败')}") from None
        except (urllib.error.URLError, TimeoutError):
            raise LandingGuideApiError("企业AI落地导航服务暂时不可达") from None
        if not isinstance(payload, dict):
            raise LandingGuideApiError("服务返回了无效JSON结构")
        return payload

    def health(self):
        return self.request("GET", "/health")

    def create(self, external_session_id: str, mode: str = "", campaign_code: str = ""):
        payload = {"sourcePlatform": "DIFY", "sourceVersion": "1.2.0", "externalSessionId": external_session_id}
        if mode:
            payload["mode"] = mode
        if campaign_code:
            payload["campaignCode"] = campaign_code
        return self.request("POST", "/sessions", payload)

    def message(self, session_id: str, token: str, message: str, mode: str, key: str):
        payload = {"message": message}
        if mode:
            payload["mode"] = mode
        return self.request("POST", f"/sessions/{session_id}/messages", payload, token, key)

    def upload_text(self, session_id: str, token: str, filename: str, content: str, key: str):
        boundary = f"----elag-{secrets.token_hex(16)}"
        safe_name = filename.replace('"', "")[:200]
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{safe_name}\"\r\n"
            "Content-Type: text/plain; charset=utf-8\r\n\r\n"
        ).encode() + content.encode("utf-8") + f"\r\n--{boundary}--\r\n".encode()
        return self.request("POST", f"/sessions/{session_id}/attachments", body, token, key, f"multipart/form-data; boundary={boundary}")

    def generate(self, session_id: str, token: str, key: str):
        return self.request("POST", f"/sessions/{session_id}/generate-map", {}, token, key)

    def get_map(self, session_id: str, token: str):
        return self.request("GET", f"/sessions/{session_id}/map", token=token)

    def consent_and_convert(self, session_id: str, token: str, consent: dict[str, Any], key: str):
        if consent.get("consentToStore") is not True:
            raise LandingGuideApiError("未明确同意保存，不能申请FDE人工复核")
        self.request("POST", f"/sessions/{session_id}/consent", consent, token, f"{key}-consent")
        return self.request("POST", f"/sessions/{session_id}/convert", {}, token, f"{key}-convert")

    def delete(self, session_id: str, token: str):
        return self.request("DELETE", f"/sessions/{session_id}", token=token)
