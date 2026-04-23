import { RuntimeKernel } from './runtime-kernel.js';

export type AgentRuntimeEngineOptions = ConstructorParameters<typeof RuntimeKernel>[0];

export class AgentRuntimeEngine extends RuntimeKernel {}

export function createAgentRuntimeEngine(options: AgentRuntimeEngineOptions): AgentRuntimeEngine {
    return new AgentRuntimeEngine(options);
}
