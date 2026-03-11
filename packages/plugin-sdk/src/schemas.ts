export interface SchemaAdapter<T = unknown> {
  parse(input: unknown): T;
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
}

export interface ConfigSchemaExtension<T = unknown> {
  key: string;
  schema: SchemaAdapter<T>;
  description?: string;
}
