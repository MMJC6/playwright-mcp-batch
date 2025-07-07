/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from './fixtures.js';

test('test batch sequence tool exists', async ({ client }) => {
  const { tools } = await client.listTools();
  const batchSequenceTool = tools.find(t => t.name === 'browser_batch_execute');
  expect(batchSequenceTool).toBeDefined();
  expect(batchSequenceTool?.description).toContain('Execute a sequence of any Playwright MCP tools');
});

test('test batch sequence with navigation and snapshot', async ({ client, server }) => {
  const result = await client.callTool('browser_batch_execute', {
    operations: [
      {
        toolName: 'browser_navigate',
        params: { url: server.url },
        description: 'Navigate to test server'
      },
      {
        toolName: 'browser_snapshot',
        params: {},
        description: 'Take page snapshot'
      }
    ],
    continueOnError: true
  });

  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain('✅ All 2 operations completed successfully');
});

test('test batch sequence with wait operation', async ({ client, server }) => {
  const result = await client.callTool('browser_batch_execute', {
    operations: [
      {
        toolName: 'browser_navigate',
        params: { url: server.url },
        description: 'Navigate to test server'
      },
      {
        toolName: 'browser_wait_for',
        params: { time: 1 },
        description: 'Wait for 1 second'
      },
      {
        toolName: 'browser_snapshot',
        params: {},
        description: 'Take final snapshot'
      }
    ],
    continueOnError: true
  });

  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain('✅ All 3 operations completed successfully');
});

test('test batch sequence with invalid tool name', async ({ client, server }) => {
  const result = await client.callTool('browser_batch_execute', {
    operations: [
      {
        toolName: 'browser_navigate',
        params: { url: server.url },
        description: 'Navigate to test server'
      },
      {
        toolName: 'invalid_tool_name',
        params: {},
        description: 'This should fail'
      },
      {
        toolName: 'browser_snapshot',
        params: {},
        description: 'Take snapshot after failure'
      }
    ],
    continueOnError: true
  });

  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain('⚠️ Partial success: 2/3 operations completed');
  expect(result.content[0].text).toContain('Tool "invalid_tool_name" not found in registry');
});

test('test batch sequence with invalid parameters', async ({ client, server }) => {
  const result = await client.callTool('browser_batch_execute', {
    operations: [
      {
        toolName: 'browser_navigate',
        params: { url: server.url },
        description: 'Navigate to test server'
      },
      {
        toolName: 'browser_wait_for',
        params: { invalidParam: 'invalid' },
        description: 'Wait with invalid params'
      },
      {
        toolName: 'browser_snapshot',
        params: {},
        description: 'Take snapshot after failure'
      }
    ],
    continueOnError: true
  });

  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain('⚠️ Partial success: 2/3 operations completed');
});

test('test batch sequence with tab operations', async ({ client, server }) => {
  const result = await client.callTool('browser_batch_execute', {
    operations: [
      {
        toolName: 'browser_navigate',
        params: { url: server.url },
        description: 'Navigate to test server'
      },
      {
        toolName: 'browser_tab_new',
        params: { url: server.url + '/page2' },
        description: 'Open new tab'
      },
      {
        toolName: 'browser_tab_list',
        params: {},
        description: 'List all tabs'
      }
    ],
    continueOnError: true
  });

  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain('✅ All 3 operations completed successfully');
});

test('test batch sequence error handling with continueOnError false', async ({ client }) => {
  const result = await client.callTool('browser_batch_execute', {
    operations: [
      {
        toolName: 'invalid_tool_name',
        params: {},
        description: 'This should fail immediately'
      },
      {
        toolName: 'browser_snapshot',
        params: {},
        description: 'This should not execute'
      }
    ],
    continueOnError: false
  });

  expect(result.isError).toBeFalsy();
  // Even with continueOnError: false, the tool should still report results
  expect(result.content[0].text).toContain('operations completed');
});

test('test batch sequence with console and network tools', async ({ client, server }) => {
  const result = await client.callTool('browser_batch_execute', {
    operations: [
      {
        toolName: 'browser_navigate',
        params: { url: server.url },
        description: 'Navigate to test server'
      },
      {
        toolName: 'browser_console_messages',
        params: {},
        description: 'Get console messages'
      },
      {
        toolName: 'browser_network_requests',
        params: {},
        description: 'Get network requests'
      }
    ],
    continueOnError: true
  });

  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain('✅ All 3 operations completed successfully');
});
