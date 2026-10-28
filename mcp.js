const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const ROUTES = {
  getLatestRun: '/api/runs/latest',
  getLatestRunDetail: '/api/runs/latest/detail',
  getRecentRuns: '/api/runs/recent',
};

function readConfig(env) {
  if (env.MCP_ENABLED !== 'true') return null;
  const base = new URL(env.BASE_URL);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.username || base.password || base.search || base.hash) {
    throw new Error('MCP requires clean HTTPS BASE_URL');
  }
  if (!env.API_KEY) throw new Error('Missing API_KEY');
  if (!env.MCP_API_KEY) throw new Error('Missing MCP_API_KEY');
  return { resource: `${base.origin}/mcp`, apiKey: env.API_KEY, mcpApiKey: env.MCP_API_KEY, port: env.PORT || '3000' };
}

function publicTrainingData(value) {
  if (Array.isArray(value)) return value.map(publicTrainingData);
  if (value && typeof value === 'object') {
    const privateFields = /^(start_latlng|end_latlng|location_city|location_state|location_country|map|polyline|summary_polyline|start_latitude|start_longitude|end_latitude|end_longitude|athlete|photos|private|visibility)$/i;
    return Object.fromEntries(Object.entries(value).filter(([k]) => !privateFields.test(k)).map(([k,v]) => [k,publicTrainingData(v)]));
  }
  return value;
}

function createQuery(config) {
  return async (name, args) => {
    const path = name === 'getRunById' ? `/api/runs/${args.id}` : ROUTES[name];
    if (!path) throw new Error('Unknown operation');
    // Fixed loopback destination. The API key never reaches the MCP client.
    const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Running API returned ${response.status}`);
    return response.json();
  };
}

function createMcpServer(query) {
  const server = new McpServer({ name: 'strava-running-api', version: '1.0.0' });
  const definitions = [
    ['getLatestRun', 'Resumen de la última corrida; verificar fecha local.'],
    ['getLatestRunDetail', 'Última corrida con summary y splits kilométricos. Para vueltas de series, consultar después getRunById con el ID recibido.'],
    ['getRecentRuns', 'Hasta 10 corridas entre las 50 actividades más recientes; no es historial completo.'],
    ['getRunById', 'Detalle por ID: métricas en raíz, splits y laps originales de Strava; distancias de splits y laps en metros.'],
  ];
  for (const [name, description] of definitions) {
    server.registerTool(name, {
      description,
      inputSchema: name === 'getRunById' ? { id: z.string().regex(/^[1-9][0-9]{0,19}$/).describe('ID de Strava como cadena para conservar precisión') } : {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async args => {
      try {
        const data = await query(name, args);
        return { content: [{ type: 'text', text: JSON.stringify(publicTrainingData(data)) }] };
      } catch {
        return { isError: true, content: [{ type: 'text', text: 'No se pudo consultar la actividad. Verificar disponibilidad y autorización de Strava; no inventar datos.' }] };
      }
    });
  }
  return server;
}

async function installMcp(app, config, options = {}) {
  if (!config) return;
  const query = options.query || createQuery(config);
  // MCP requires its own bearer key; /api/* uses API_KEY.
  app.use('/mcp', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!config.mcpApiKey || req.headers.authorization !== `Bearer ${config.mcpApiKey}`) {
      return res.status(401).json({ error: 'MCP authorization required' });
    }
    const started = Date.now();
    const method = req.method;
    res.once('finish', () => {
      // Only transport metadata: never log headers, tokens, payloads, activity IDs or locations.
      console.info('[mcp-diagnostic]', JSON.stringify({
        httpMethod: method,
        status: res.statusCode,
        durationMs: Date.now() - started,
      }));
    });
    next();
  });
  app.post('/mcp', express.json({ limit: '64kb' }), async (req, res) => {
    const server = createMcpServer(query);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      // Error class only; error messages may contain request details or credentials.
      console.error('[mcp-diagnostic] handler failure', error?.name || 'UnknownError');
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
    }
  });
  app.all('/mcp', (req, res) => res.status(405).set('Allow', 'POST').end());
}

module.exports = { readConfig, publicTrainingData, createQuery, createMcpServer, installMcp };

