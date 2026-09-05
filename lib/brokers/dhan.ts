import type { BrokerAdapter, Holding } from "./types";

// Dhan (DhanHQ v2). Token-based auth: the user generates a personal access
// token from the Dhan web dashboard (no OAuth redirect app-approval needed),
// which is why it's the fastest real integration.
//
// Holdings endpoint: GET https://api.dhan.co/v2/holdings
// Header: access-token: <token>
// Returns an array with tradingSymbol / exchange / totalQty / avgCostPrice.
export const dhanAdapter: BrokerAdapter = {
  id: "dhan",
  label: "Dhan",
  help: "Dhan dashboard → DhanHQ / API Access → generate an access token. Also copy your Client ID.",
  fields: [
    { key: "accessToken", label: "Access token", placeholder: "eyJ0eXAi…" },
    { key: "clientId", label: "Client ID", placeholder: "1000000123" },
  ],

  async getHoldings(creds): Promise<Holding[]> {
    const token = creds.accessToken?.trim();
    if (!token) throw new Error("Dhan access token required");

    const res = await fetch("https://api.dhan.co/v2/holdings", {
      headers: {
        "access-token": token,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(
        `Dhan holdings failed (${res.status}) — check the token is valid and not expired`
      );
    }

    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return [];

    const out: Holding[] = [];
    for (const h of data) {
      const raw = String(h.tradingSymbol ?? "").toUpperCase().trim();
      if (!raw) continue;
      // Normalize Dhan's occasional "-EQ" suffix to the plain NSE symbol.
      const symbol = raw.replace(/-EQ$/, "");
      out.push({
        symbol,
        exchange: h.exchange ? String(h.exchange) : undefined,
        qty:
          typeof h.totalQty === "number"
            ? h.totalQty
            : Number(h.totalQty ?? 0) || undefined,
        avgPrice:
          typeof h.avgCostPrice === "number"
            ? h.avgCostPrice
            : Number(h.avgCostPrice ?? 0) || undefined,
      });
    }
    return out;
  },
};
