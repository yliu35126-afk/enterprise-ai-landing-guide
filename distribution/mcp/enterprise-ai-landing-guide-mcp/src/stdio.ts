import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createLandingMcpServer } from './server.js';

serveStdio(() => createLandingMcpServer(), {
  onerror: (error) => process.stderr.write(`MCP stdio error: ${String(error?.message || 'unknown').slice(0, 300)}\n`),
});
