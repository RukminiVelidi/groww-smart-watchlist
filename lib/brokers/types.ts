// Provider-agnostic broker interface. "Connect broker" is not hardcoded to one
// vendor: each broker implements the same contract, so Groww/Dhan/Upstox drop
// in behind the same UI and service code. A truly universal button would sit on
// SEBI's Account Aggregator framework (via a registered FIU) — noted in README.

export type Holding = {
  symbol: string; // NSE trading symbol, e.g. "RELIANCE"
  exchange?: string;
  qty?: number;
  avgPrice?: number;
};

// A credential field the UI should collect for this broker (token-based auth).
export type CredentialField = {
  key: string;
  label: string;
  placeholder?: string;
};

export interface BrokerAdapter {
  id: string;
  label: string;
  // Where the user obtains the token — shown in the connect dialog.
  help: string;
  fields: CredentialField[];
  getHoldings(creds: Record<string, string>): Promise<Holding[]>;
}
