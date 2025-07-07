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

import { z } from 'zod';
import { defineTool, type Tool } from './tool.js';
import type { Context } from '../context.js';

// Global tool registry - will be populated lazily to avoid circular dependencies
let TOOL_REGISTRY: Map<string, Tool<any>> | null = null;

/**
 * Get or create the tool registry, loading tools lazily to avoid circular dependencies
 */
async function getToolRegistry(): Promise<Map<string, Tool<any>>> {
  if (TOOL_REGISTRY)
    return TOOL_REGISTRY;


  TOOL_REGISTRY = new Map<string, Tool<any>>();

  // Import tools dynamically to avoid circular dependency
  const { snapshotTools } = await import('../tools.js');

  // Filter out batch tools to avoid circular dependency
  const filteredTools = snapshotTools.filter(tool =>
    !tool.schema.name.startsWith('browser_batch_')
  );

  // Register each tool by its schema name
  for (const tool of filteredTools)
    TOOL_REGISTRY.set(tool.schema.name, tool);


  return TOOL_REGISTRY;
}

// Type definitions for generic tool operations
type GenericToolOperation = {
  toolName: string; // The schema name of the tool (e.g., 'browser_click', 'browser_navigate')
  params: Record<string, any>; // Tool-specific parameters
  description?: string; // Optional human-readable description for logging
};

type OperationResult = {
  index: number;
  operation: GenericToolOperation;
  success: boolean;
  error?: string;
  toolResult?: any;
  actionResult?: any; // 新增：存储action的执行结果
};

type BatchExecutionResult = {
  totalOperations: number;
  successfulOperations: number;
  results: OperationResult[];
  partialSuccess: boolean;
};

/**
 * Generic batch tool executor that can execute any sequence of Playwright MCP tools
 */
class BatchSequenceExecutor {
  constructor(private context: Context) {}

  async executeOperation(operation: GenericToolOperation): Promise<{
    success: boolean;
    error?: string;
    toolResult?: any;
    actionResult?: any; // 新增：用于存储action的返回值
  }> {
    try {
      // Get the tool registry (lazy loading)
      const toolRegistry = await getToolRegistry();

      // Find the tool in the registry
      const tool = toolRegistry.get(operation.toolName);
      if (!tool)
        throw new Error(`Tool "${operation.toolName}" not found in registry. Available tools: ${Array.from(toolRegistry.keys()).join(', ')}`);


      // Validate parameters against the tool's schema
      const validatedParams = tool.schema.inputSchema.parse(operation.params);

      // Execute the tool's handle method
      const toolResult = await tool.handle(this.context, validatedParams);

      let actionResult; // 声明一个变量来捕获action结果
      if (toolResult.action)
        actionResult = await toolResult.action(); // 捕获返回值

      // 在返回值中包含 actionResult
      return { success: true, toolResult, actionResult };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async executeBatch(operations: GenericToolOperation[]): Promise<BatchExecutionResult> {
    const results: OperationResult[] = [];
    let successCount = 0;

    for (const [index, operation] of operations.entries()) {
      const result = await this.executeOperation(operation);

      results.push({
        index,
        operation,
        success: result.success,
        error: result.error,
        toolResult: result.toolResult,
        actionResult: result.actionResult // 传递actionResult
      });

      if (result.success)
        successCount++;

      // Continue executing remaining operations even if one fails (partial success mode)
    }

    return {
      totalOperations: operations.length,
      successfulOperations: successCount,
      results,
      partialSuccess: successCount > 0 && successCount < operations.length
    };
  }
}

/**
 * Format batch execution results for user-friendly display
 */
async function formatBatchResult(result: BatchExecutionResult): Promise<string> {
  const lines: string[] = [];

  if (result.successfulOperations === result.totalOperations) {
    lines.push(`✅ All ${result.totalOperations} operations completed successfully`);
  } else if (result.successfulOperations > 0) {
    lines.push(`⚠️ Partial success: ${result.successfulOperations}/${result.totalOperations} operations completed`);
    lines.push(`\n**Successful operations:** ${result.successfulOperations}`);
    lines.push(`**Failed operations:** ${result.results.filter(r => !r.success).length}`);
  } else {
    lines.push(`❌ All operations failed`);
  }

  // Add error details for failed operations
  const failedOperations = result.results.filter(r => !r.success);
  if (failedOperations.length > 0) {
    lines.push(`\n**Error details:**`);
    for (const failure of failedOperations) {
      const desc = failure.operation.description || failure.operation.toolName;
      lines.push(`- Step ${failure.index + 1} (${desc}): ${failure.error}`);
    }
  }

  // Add successful operations summary
  const successfulOperations = result.results.filter(r => r.success);
  if (successfulOperations.length > 0 && failedOperations.length > 0) {
    lines.push(`\n**Successful steps:**`);
    for (const success of successfulOperations) {
      const desc = success.operation.description || success.operation.toolName;
      lines.push(`- Step ${success.index + 1} (${desc}): ✅ Completed`);
    }
  }

  if (failedOperations.length > 0)
    lines.push(`\n**Recommendation:** Use individual browser tools to retry failed operations manually.`);


  // Add available tools information
  const toolRegistry = await getToolRegistry();
  lines.push(`\n**Available tools:** ${Array.from(toolRegistry.keys()).sort().join(', ')}`);

  return lines.join('\n');
}

/**
 * Generate code comments based on actual execution results
 */
function generateBatchCode(result: BatchExecutionResult): string[] {
  const code: string[] = [
    `// Batch sequence execution: ${result.successfulOperations}/${result.totalOperations} completed`
  ];

  for (const operationResult of result.results) {
    if (operationResult.success && operationResult.toolResult) {
      // Use the code generated by the original tool
      code.push(...operationResult.toolResult.code);
    } else {
      // Add comment for failed operations
      const desc = operationResult.operation.description || operationResult.operation.toolName;
      code.push(`// FAILED: ${desc} - ${operationResult.error}`);
    }
  }

  return code;
}

// Schema definition for batch sequence operations
const batchSequenceSchema = z.object({
  operations: z.array(z.object({
    toolName: z.string().describe('The schema name of the Playwright MCP tool to execute (e.g., "browser_click", "browser_navigate", "browser_wait_for")'),
    params: z.record(z.any()).describe('Tool-specific parameters as key-value pairs. Must match the tool\'s input schema.'),
    description: z.string().optional().describe('Optional human-readable description for this operation (for logging purposes)')
  })).min(1).max(20).describe('Sequence of tool operations to execute (1-20 operations)'),
  continueOnError: z.boolean().default(true).describe('Continue executing remaining operations if one fails (partial success mode)')
});

// Main batch sequence tool definition
const batchSequence = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_batch_execute',
    title: 'Execute Tool Sequence',
    description: 'Executes a sequence of any available Playwright MCP tools in a single, atomic operation. This is the preferred method for any task requiring one or more destructive actions. The tool will intelligently wait for the page to stabilize before automatically capturing a final snapshot.',
    inputSchema: batchSequenceSchema,
    type: 'destructive',
  },

  handle: async (context, params) => {
    const executor = new BatchSequenceExecutor(context);
    const batchResult = await executor.executeBatch(params.operations);
    const code = generateBatchCode(batchResult);

    const finalResult: any = {
      code,
      action: async () => ({
        content: [{ type: 'text', text: await formatBatchResult(batchResult) }]
      }),
      captureSnapshot: false,
      waitForNetwork: true,
    };

    try {
      // --- 新增：上下文感知的动态等待逻辑 ---

      // 1. 判断本次批量操作是否包含导航
      const isNavigation = params.operations.some(op => op.toolName === 'browser_navigate');

      if (isNavigation) {
        // 2. 如果是导航操作，使用最可靠的"等待网络空闲"策略
        console.log('Navigation detected. Waiting for network to be idle...');
        await context.currentTabOrDie().page.waitForLoadState('networkidle', { timeout: 10000 }); // 导航等待时间可以长一些
        console.log('Network is idle.');
      } else {
        // 3. 对于其他所有普通交互（如点击、输入），使用一个固定的短暂等待，让UI有时间响应
        console.log('Interaction detected. Applying a short wait for UI to settle...');
        await context.currentTabOrDie().page.waitForTimeout(300); // 等待300毫秒，这个时间通常足够大多数UI动画完成
      }

      // --- 动态等待逻辑结束 ---

      // 在智能等待之后，手动捕获快照
      console.log('Capturing final snapshot...');
      const tab = context.currentTabOrDie();
      await tab.captureSnapshot();

      // 获取快照文本并添加到输出中
      if (tab.hasSnapshot()) {
        const snapshotText = tab.snapshotOrDie().text();
        const currentContent = (await finalResult.action()).content;
        finalResult.action = async () => ({
          content: [
            ...currentContent,
            { type: 'text', text: snapshotText }
          ]
        });
      }
    } catch (error) {
        const currentContent = (await finalResult.action()).content;
        const errorMessage = `\n⚠️ Warning: Failed during intelligent wait or snapshot capture: ${error instanceof Error ? error.message : String(error)}`;
        currentContent.push({ type: 'text', text: errorMessage });
        finalResult.action = async () => ({ content: currentContent });
    }

    return finalResult;
  },
});

export default [batchSequence];
