/**
 * Host Registry — registry-driven host adapter system.
 *
 * Eliminates hard-coded host arrays in favor of dynamic registration.
 * New hosts require only a single adapter file + registerHost() call.
 */

import type { HostAdapter } from "./schema";

export class HostRegistry {
  private adapters = new Map<string, HostAdapter>();

  register(adapter: HostAdapter): void {
    if (this.adapters.has(adapter.key)) {
      throw new Error(`Host adapter '${adapter.key}' is already registered`);
    }
    this.adapters.set(adapter.key, adapter);
  }

  unregister(key: string): boolean {
    return this.adapters.delete(key);
  }

  get(key: string): HostAdapter | undefined {
    return this.adapters.get(key);
  }

  has(key: string): boolean {
    return this.adapters.has(key);
  }

  /** List all registered host keys */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** Find the first host whose detect() returns true */
  detectActive(): HostAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.detect()) return adapter;
    }
    return undefined;
  }

  /** Get all adapters whose detect() returns true */
  detectAll(): HostAdapter[] {
    return Array.from(this.adapters.values()).filter((a) => a.detect());
  }
}

/** Global singleton registry */
export const HOST_REGISTRY = new HostRegistry();

/** Convenience shorthand for HOST_REGISTRY.register */
export function registerHost(adapter: HostAdapter): void {
  HOST_REGISTRY.register(adapter);
}
