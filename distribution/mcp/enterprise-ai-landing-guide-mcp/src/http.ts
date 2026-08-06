import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp, originValidation } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { NextFunction, Request, Response } from 'express';
import { createLandingMcpServer } from './server.js';

const host = process.env.MCP_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.MCP_PORT || 3030);
const production = process.env.NODE_ENV === 'production';
const accessToken = process.env.MCP_ACCESS_TOKEN || '';
const allowedHosts = (process.env.MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1]').split(',').map((item) => item.trim()).filter(Boolean);
const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || allowedHosts.join(',')).split(',').map((item) => item.trim()).filter(Boolean);

if (production && accessToken.length < 32) throw new Error('MCP_ACCESS_TOKEN must contain at least 32 characters in production');

export function buildHttpApp() {
  const app = createMcpExpressApp({ host, allowedHosts });
  app.disable('x-powered-by');
  app.use(originValidation(allowedOrigins));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/mcp', authenticate);
  app.all('/mcp', async (req, res) => {
    const server = createLandingMcpServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('finish', () => server.close().catch(() => undefined));
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'MCP request failed' }, id: null });
    }
  });
  return app;
}

function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!accessToken && !production) return next();
  const authorization = String(req.headers.authorization || '');
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!constantTimeEqual(accessToken, supplied)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

function constantTimeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  buildHttpApp().listen(port, host, () => process.stderr.write(`Enterprise AI Landing MCP listening on ${host}:${port}\n`));
}
