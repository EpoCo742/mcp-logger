/** Seed data for the investment-advisor world. All figures are fictional. */
export const AS_OF = "2026-10-10T20:00:00Z"; // last market close

export type Firm = {
  org_id: string;
  name: string;
  api_key: string;
  advisors: { id: string; name: string }[];
  represents: string[]; // customer ids the firm is authorised to act for
};

export const FIRMS: Firm[] = [
  {
    org_id: "northstar-advisors",
    name: "Northstar Advisors LLC",
    api_key: "nsa-live-key-7731",
    advisors: [
      { id: "ADV-101", name: "Priya Natarajan" },
      { id: "ADV-102", name: "Marcus Hill" },
    ],
    represents: ["C-1001", "C-1002"],
  },
  {
    org_id: "harbor-wealth",
    name: "Harbor Wealth Partners",
    api_key: "hwp-live-key-2208",
    advisors: [{ id: "ADV-201", name: "Tom Becker" }],
    represents: ["C-1003"],
  },
];

export type Customer = {
  customer_id: string;
  name: string;
  date_of_birth: string;
  ssn: string;
  email: string;
  phone: string;
  risk_profile: string;
  advisory_firm: string;
};

export const CUSTOMERS: Customer[] = [
  {
    customer_id: "C-1001",
    name: "Jane Doe",
    date_of_birth: "1978-04-12",
    ssn: "123-45-6789",
    email: "jane.doe@example.com",
    phone: "+1-312-555-0142",
    risk_profile: "Moderate growth",
    advisory_firm: "northstar-advisors",
  },
  {
    customer_id: "C-1002",
    name: "Robert Chen",
    date_of_birth: "1965-11-02",
    ssn: "987-65-4321",
    email: "r.chen@example.com",
    phone: "+1-415-555-0199",
    risk_profile: "Conservative income",
    advisory_firm: "northstar-advisors",
  },
  {
    customer_id: "C-1003",
    name: "Maria Lopez",
    date_of_birth: "1989-07-23",
    ssn: "456-78-9012",
    email: "maria.lopez@example.com",
    phone: "+1-305-555-0177",
    risk_profile: "Aggressive growth",
    advisory_firm: "harbor-wealth",
  },
];

export type Account = { account_id: string; customer_id: string; type: string; title: string; opened: string };
export const ACCOUNTS: Account[] = [
  { account_id: "A-2001", customer_id: "C-1001", type: "Individual Brokerage", title: "Jane Doe", opened: "2015-03-02" },
  { account_id: "A-2002", customer_id: "C-1001", type: "Traditional IRA", title: "Jane Doe IRA", opened: "2016-01-19" },
  { account_id: "A-2003", customer_id: "C-1002", type: "Joint Brokerage", title: "Robert & Lin Chen JTWROS", opened: "2009-08-11" },
  { account_id: "A-2004", customer_id: "C-1003", type: "Roth IRA", title: "Maria Lopez Roth", opened: "2021-05-30" },
  { account_id: "A-2005", customer_id: "C-1003", type: "Individual Brokerage", title: "Maria Lopez", opened: "2020-02-14" },
];

export type Position = { symbol: string; description: string; quantity: number; price: number; market_value: number; cost_basis: number };
export const POSITIONS: Record<string, Position[]> = {
  "A-2001": [
    { symbol: "VTI", description: "Vanguard Total Stock Market ETF", quantity: 850, price: 312.4, market_value: 265540, cost_basis: 201300 },
    { symbol: "AAPL", description: "Apple Inc.", quantity: 400, price: 241.15, market_value: 96460, cost_basis: 58200 },
    { symbol: "BND", description: "Vanguard Total Bond Market ETF", quantity: 1200, price: 74.9, market_value: 89880, cost_basis: 92100 },
    { symbol: "MSFT", description: "Microsoft Corp.", quantity: 120, price: 498.2, market_value: 59784, cost_basis: 31900 },
  ],
  "A-2002": [
    { symbol: "VOO", description: "Vanguard S&P 500 ETF", quantity: 310, price: 571.3, market_value: 177103, cost_basis: 120500 },
    { symbol: "VXUS", description: "Vanguard Total Intl Stock ETF", quantity: 900, price: 68.2, market_value: 61380, cost_basis: 54800 },
  ],
  "A-2003": [
    { symbol: "SCHD", description: "Schwab US Dividend Equity ETF", quantity: 2100, price: 29.8, market_value: 62580, cost_basis: 51200 },
    { symbol: "VTEB", description: "Vanguard Tax-Exempt Bond ETF", quantity: 4000, price: 51.1, market_value: 204400, cost_basis: 203000 },
  ],
  "A-2004": [{ symbol: "QQQ", description: "Invesco QQQ Trust", quantity: 150, price: 612.5, market_value: 91875, cost_basis: 64000 }],
  "A-2005": [
    { symbol: "NVDA", description: "NVIDIA Corp.", quantity: 300, price: 188.4, market_value: 56520, cost_basis: 21000 },
    { symbol: "TSLA", description: "Tesla Inc.", quantity: 100, price: 402.1, market_value: 40210, cost_basis: 38800 },
  ],
};

export type Balances = { cash: number; margin_available: number; securities_value: number; total_value: number; currency: string };
export const BALANCES: Record<string, Balances> = {
  "A-2001": { cash: 248210.55, margin_available: 120000, securities_value: 511664, total_value: 759874.55, currency: "USD" },
  "A-2002": { cash: 6120.0, margin_available: 0, securities_value: 238483, total_value: 244603.0, currency: "USD" },
  "A-2003": { cash: 15900.25, margin_available: 60000, securities_value: 266980, total_value: 282880.25, currency: "USD" },
  "A-2004": { cash: 2210.1, margin_available: 0, securities_value: 91875, total_value: 94085.1, currency: "USD" },
  "A-2005": { cash: 9340.0, margin_available: 20000, securities_value: 96730, total_value: 106070.0, currency: "USD" },
};

export type Transaction = { txn_id: string; date: string; type: string; symbol?: string; amount: number; description: string };
export const TRANSACTIONS: Record<string, Transaction[]> = {
  "A-2001": [
    { txn_id: "TX-5001", date: "2026-10-01", type: "DIVIDEND", symbol: "VTI", amount: 712.4, description: "VTI quarterly dividend" },
    { txn_id: "TX-5002", date: "2026-09-18", type: "BUY", symbol: "MSFT", amount: -24910, description: "Buy 50 MSFT @ 498.20" },
    { txn_id: "TX-5003", date: "2026-09-02", type: "ACH_IN", amount: 25000, description: "ACH from Chase ...4411" },
  ],
  "A-2002": [{ txn_id: "TX-5101", date: "2026-09-30", type: "DIVIDEND", symbol: "VOO", amount: 530.1, description: "VOO quarterly dividend" }],
  "A-2003": [{ txn_id: "TX-5201", date: "2026-09-25", type: "INTEREST", amount: 410.2, description: "Muni bond interest" }],
  "A-2004": [],
  "A-2005": [{ txn_id: "TX-5401", date: "2026-09-12", type: "SELL", symbol: "TSLA", amount: 20105, description: "Sell 50 TSLA @ 402.10" }],
};

export type TransferDestination = { destination_id: string; customer_id: string; type: string; label: string; verified: boolean };
export const DESTINATIONS: TransferDestination[] = [
  { destination_id: "DEST-9001", customer_id: "C-1001", type: "ACH", label: "Chase Checking ...4411", verified: true },
  { destination_id: "DEST-9002", customer_id: "C-1001", type: "WIRE", label: "First Republic Savings ...8820", verified: true },
  { destination_id: "DEST-9003", customer_id: "C-1002", type: "ACH", label: "Wells Fargo Checking ...1203", verified: true },
  { destination_id: "DEST-9004", customer_id: "C-1003", type: "ACH", label: "BofA Checking ...7761", verified: true },
];

export const QUOTES: Record<string, number> = { VTI: 312.4, AAPL: 241.15, BND: 74.9, MSFT: 498.2, VOO: 571.3, VXUS: 68.2, SCHD: 29.8, VTEB: 51.1, QQQ: 612.5, NVDA: 188.4, TSLA: 402.1, SPY: 668.9 };
