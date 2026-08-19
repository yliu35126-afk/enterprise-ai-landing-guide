export class CoreApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export class LandingCoreClient {
  private readonly prefix = '/api/public/clawhive/v1';

  constructor(
    private readonly baseUrl = (process.env.ENTERPRISE_AI_LANDING_API_BASE || 'http://127.0.0.1:3020').replace(/\/$/, ''),
    private readonly timeoutMs = Number(process.env.MCP_CORE_TIMEOUT_MS || 35_000),
  ) {}

  async request(method: string, path: string, options: {
    body?: Record<string, unknown>;
    token?: string;
    idempotencyKey?: string;
  } = {}) {
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'enterprise-ai-landing-guide-mcp/1.0.0' };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${this.prefix}${path}`, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new CoreApiError(503, 'MCP-CORE-UNAVAILABLE', '企业AI落地导航核心服务暂时不可达');
    }
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new CoreApiError(response.status, String(payload?.code || 'MCP-CORE-ERROR'), String(payload?.message || '核心服务请求失败').slice(0, 300));
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CoreApiError(502, 'MCP-CORE-INVALID', '核心服务返回了无效结构');
    }
    return payload as Record<string, unknown>;
  }

  create(input: Record<string, unknown>) { return this.request('POST', '/sessions', { body: input }); }
  answer(sessionId: string, token: string, input: Record<string, unknown>, key: string) {
    return this.request('POST', `/sessions/${encodeURIComponent(sessionId)}/messages`, { body: input, token, idempotencyKey: key });
  }
  generate(sessionId: string, token: string, key: string) {
    return this.request('POST', `/sessions/${encodeURIComponent(sessionId)}/generate-map`, { body: {}, token, idempotencyKey: key });
  }
  map(sessionId: string, token: string) {
    return this.request('GET', `/sessions/${encodeURIComponent(sessionId)}/map`, { token });
  }
  consent(sessionId: string, token: string, input: Record<string, unknown>, key: string) {
    return this.request('POST', `/sessions/${encodeURIComponent(sessionId)}/consent`, { body: input, token, idempotencyKey: `${key}-consent` });
  }
  convert(sessionId: string, token: string, key: string) {
    return this.request('POST', `/sessions/${encodeURIComponent(sessionId)}/convert`, { body: {}, token, idempotencyKey: `${key}-convert` });
  }
  delete(sessionId: string, token: string) {
    return this.request('DELETE', `/sessions/${encodeURIComponent(sessionId)}`, { token });
  }
}
