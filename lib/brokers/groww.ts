import type { BrokerAdapter, Holding } from "./types";

// Groww (Groww TradeAPI). Token-based, like Dhan. The exact holdings endpoint
// and response shape are filled in once we confirm API access from a Groww
// account. The contract below is identical to every other adapter, so wiring it
// is a ~10-line change with zero impact on the UI or service layer.
export const growwAdapter: BrokerAdapter = {
  id: "groww",
  label: "Groww",
  help: "Groww → Developer / TradeAPI → generate an access token.",
  fields: [{ key: "accessToken", label: "Access token", placeholder: "…" }],

  async getHoldings(creds): Promise<Holding[]> {
    const token = creds.accessToken?.trim();
    if (!token) throw new Error("Groww access token required");

    // TODO: confirmed endpoint/shape once Groww API access is set up, e.g.:
    //   GET https://api.groww.in/.../holdings  (Authorization: Bearer <token>)
    // Parse the holdings array into Holding[] exactly like the Dhan adapter.
    throw new Error(
      "Groww adapter not yet configured — provide Groww API endpoint/token details to enable."
    );
  },
};
