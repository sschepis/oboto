/**
 * Tool definitions for BubbleLab workflow automations bound to Surfaces.
 * These tools let the AI agent create, run, and manage automation workflows
 * that use Surfaces as their interactive UI layer.
 */
export const WORKFLOW_SURFACE_TOOLS = [
    {
        type: "function",
        function: {
            name: "start_surface_workflow",
            description: `Start a BubbleLab automation workflow bound to a surface. The workflow is written as a BubbleFlow class in TypeScript.

The flow_script should be a complete BubbleFlow class that extends BubbleFlow and implements handle(). Available Bubbles include:
- AIAgentBubble: LLM-powered agent for text generation, analysis, decisions
- HttpBubble: Make HTTP requests (GET, POST, etc.)
- StorageBubble: Read/write persistent key-value data
- WebSearchTool: Search the web for information
- WebScrapeTool: Scrape content from URLs
- ChartJSTool: Generate Chart.js charts as images

Example flow:
\`\`\`typescript
import { BubbleFlow, AIAgentBubble, HttpBubble } from '@bubblelab/bubble-core';
import type { WebhookEvent, BubbleFlowOperationResult } from '@bubblelab/bubble-core';

class DataAnalysisFlow extends BubbleFlow<'webhook/http'> {
  constructor() {
    super('DataAnalysis', 'Analyzes data and presents results');
  }
  async handle(payload: WebhookEvent): Promise<BubbleFlowOperationResult> {
    const agent = new AIAgentBubble({ 
      model: 'gpt-4o-mini',
      systemPrompt: 'Analyze the following data',
      userMessage: JSON.stringify(payload.body)
    });
    const result = await agent.action();
    return { success: true, message: result.data.response };
  }
}
export { DataAnalysisFlow };
\`\`\``,
            parameters: {
                type: "object",
                properties: {
                    surface_id: {
                        type: "string",
                        description: "The surface ID to bind this workflow to"
                    },
                    flow_script: {
                        type: "string",
                        description: "Complete BubbleFlow TypeScript source code"
                    },
                    trigger_payload: {
                        type: "object",
                        description: "Optional initial payload to pass to the flow's handle() method"
                    }
                },
                required: ["surface_id", "flow_script"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_workflow_status",
            description: "Get the current status of a running workflow. Returns workflow state including status (running/completed/failed/cancelled), timing, and any errors.",
            parameters: {
                type: "object",
                properties: {
                    workflow_id: {
                        type: "string",
                        description: "The workflow ID to check"
                    }
                },
                required: ["workflow_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_workflows",
            description: "List all active workflows and their bound surfaces.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    },
    {
        type: "function",
        function: {
            name: "cancel_workflow",
            description: "Cancel a running workflow. Any pending user interactions will be rejected.",
            parameters: {
                type: "object",
                properties: {
                    workflow_id: {
                        type: "string",
                        description: "The workflow ID to cancel"
                    }
                },
                required: ["workflow_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "submit_workflow_interaction",
            description: "Submit user input data to a workflow that is waiting for interaction. Used when a workflow has paused to collect user input via a Surface component.",
            parameters: {
                type: "object",
                properties: {
                    workflow_id: {
                        type: "string",
                        description: "The workflow ID"
                    },
                    interaction_id: {
                        type: "string",
                        description: "The interaction ID from the workflow-interaction-needed event"
                    },
                    data: {
                        type: "object",
                        description: "The user's response data"
                    }
                },
                required: ["workflow_id", "interaction_id", "data"]
            }
        }
    }
];
