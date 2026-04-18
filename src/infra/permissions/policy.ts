import type { JsonRecord, JsonValue } from '@xqoder/protocol';

export type PermissionDecision = 'allow' | 'ask' | 'deny';

export type PermissionRequestKind =
  | 'path.read'
  | 'path.write'
  | 'command.exec'
  | 'tool.use'
  | 'provider.use'
  | 'plugin.enable';

export interface PermissionRequest {
  kind: PermissionRequestKind;
  target: string;
  sessionId?: string;
  cwd?: string;
  payload?: JsonValue;
  metadata?: JsonRecord;
}

export interface PermissionResolution {
  request: PermissionRequest;
  decision: PermissionDecision;
  decidedAt: number;
  decidedBy: 'policy' | 'user' | 'workspace';
}

export interface PermissionPolicy {
  evaluate(request: PermissionRequest): PermissionDecision | Promise<PermissionDecision>;
}

export class StaticPermissionPolicy implements PermissionPolicy {
  constructor(private readonly defaults: Partial<Record<PermissionRequestKind, PermissionDecision>> = {}) {}

  evaluate(request: PermissionRequest): PermissionDecision {
    return this.defaults[request.kind] ?? 'ask';
  }
}
