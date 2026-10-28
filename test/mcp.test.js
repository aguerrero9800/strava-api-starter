const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { readConfig, publicTrainingData, installMcp } = require('../mcp');

async function setup(t) {
  const app = express();
  const calls = [];
  await installMcp(app, { resource: 'https://running.example/mcp', mcpApiKey: 'test-mcp-key' }, {
    query: async (name, args) => {
      calls.push({ name, args });
      if (args.id === '999') throw new Error('secret-value');
      return { id: args.id || '123', laps: [{ distance: 800 }], start_latlng: [1, 2] };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = body => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-mcp-key', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { base, send, calls };
}

test('disabled by default and requires HTTPS and existing private API key', () => {
  assert.equal(readConfig({}), null);
  assert.throws(() => readConfig({ MCP_ENABLED: 'true' }));
  assert.throws(() => readConfig({ MCP_ENABLED: 'true', BASE_URL: 'http://localhost', API_KEY: 'test' }));
  assert.deepEqual(readConfig({ MCP_ENABLED: 'true', BASE_URL: 'https://running.example', API_KEY: 'test', MCP_API_KEY: 'test-mcp-key' }),
    { resource: 'https://running.example/mcp', apiKey: 'test', mcpApiKey: 'test-mcp-key', port: '3000' });
});

test('MCP lists four read-only tools without Auth0', async t => {
  const { send, calls } = await setup(t);
  const init = await send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.serverInfo.name, 'strava-running-api');
  const list = await (await send({jsonrpc:'2.0',id:2,method:'tools/list'})).json();
  assert.equal(list.result.tools.length, 4);
  assert.ok(list.result.tools.every(tool => tool.annotations.readOnlyHint));
  const call = await (await send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'getRunById',arguments:{id:'123'}}})).json();
  assert.equal(JSON.parse(call.result.content[0].text).laps[0].distance, 800);
  assert.ok(!JSON.stringify(call).includes('start_latlng'));
  const bad = await (await send({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'getRunById',arguments:{id:'../secret'}}})).json();
  assert.ok(bad.error || bad.result.isError);
  assert.equal(calls.length, 1);
  const failure = await (await send({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'getRunById',arguments:{id:'999'}}})).json();
  assert.equal(failure.result.isError, true);
  assert.ok(!JSON.stringify(failure).includes('secret-value'));
});

test('public output omits location fields recursively', () => {
  assert.deepEqual(publicTrainingData({ id: 1, start_latlng: [1,2], laps: [{distance:800, map:{polyline:'private'}}] }),
    {id:1, laps:[{distance:800}]});
});


test('MCP rejects unauthenticated requests', async t => { const {base}=await setup(t); const r=await fetch(base+'/mcp',{method:'POST'}); assert.equal(r.status,401); });
