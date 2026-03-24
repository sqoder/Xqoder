export class NamedRegistry<T extends { name: string }> {
  private readonly items = new Map<string, T>();

  register(item: T): void {
    this.items.set(item.name, item);
  }

  get(name: string): T | undefined {
    return this.items.get(name);
  }

  list(): T[] {
    return [...this.items.values()];
  }
}
