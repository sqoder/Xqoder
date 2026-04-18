import type { JsonRecord } from '@xqoder/protocol';

export interface CommandContext {
  cwd: string;
  args: readonly string[];
  flags: JsonRecord;
}

export interface CommandRegistration {
  name: string;
  description: string;
  aliases?: string[];
  run(context: CommandContext): Promise<void | number>;
}
