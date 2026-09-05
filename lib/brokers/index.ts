import type { BrokerAdapter } from "./types";
import { dhanAdapter } from "./dhan";
import { growwAdapter } from "./groww";

// Registry of supported brokers. Adding a provider = one import + one entry.
export const BROKERS: Record<string, BrokerAdapter> = {
  dhan: dhanAdapter,
  groww: growwAdapter,
};

export function getBroker(id: string): BrokerAdapter | null {
  return BROKERS[id] ?? null;
}

// Safe metadata for the client (never exposes tokens/logic).
export function brokerCatalog() {
  return Object.values(BROKERS).map((b) => ({
    id: b.id,
    label: b.label,
    help: b.help,
    fields: b.fields,
  }));
}
