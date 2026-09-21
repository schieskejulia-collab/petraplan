export const NORTHWIND_STRUCTURE_EVIDENCE_AUTHORITY = {
  claim: 'Orders.CustomerID -> Customers.CustomerID',
  status: 'CONFIRMED',
  meaning: 'The order-to-customer structure relation is independently represented in the pinned CSV data, a relational schema, and a graph model. This confirms the structural relation only; it does not create STATUS or MENGE meaning.',
  sources: [
    {
      kind: 'source_data',
      role: 'source_truth',
      repository: 'neo4j-contrib/northwind-neo4j',
      commit: '5db323116a2779434ba0c17eb2b733575bfc2a4a',
      reference: 'data/orders.csv + data/customers.csv',
      assertion: 'Order.CustomerID is observed together with the matching Customer.CustomerID in the pinned proof data.',
    },
    {
      kind: 'relational_schema',
      role: 'schema_authority',
      repository: 'jpwhite3/northwind-SQLite3',
      commit: '4f56e7f5906dfd23b25244c5bfe8fb5da6402efd',
      reference: 'src/create.sql',
      assertion: 'FOREIGN KEY (Orders.CustomerID) REFERENCES Customers(CustomerID).',
    },
    {
      kind: 'graph_model',
      role: 'independent_corroboration',
      repository: 'neo4j-graph-examples/northwind',
      commit: '56ee0507d33eecd8ef2a9c960ec967cd432eb57e',
      reference: 'scripts/northwind.cypher / graph import model',
      assertion: 'Customer and Order are connected through the PURCHASED relationship derived from CustomerID.',
    },
  ],
} as const;

export const NORTHWIND_QUANTITY_TRANSFORMATION_EVIDENCE = {
  field: 'MENGE',
  status: 'UNPROVEN',
  reason: 'The relational Northwind schema confirms Quantity per Order Detail and CHECK (Quantity > 0), but no pinned source confirms SUM(Order Details.Quantity) as the business meaning of Bridge.MENGE for multi-detail orders.',
  supportingSource: {
    repository: 'jpwhite3/northwind-SQLite3',
    commit: '4f56e7f5906dfd23b25244c5bfe8fb5da6402efd',
    reference: 'src/create.sql',
    observedRules: [
      'Order Details.Quantity is a position-level value.',
      'CHECK (Quantity > 0).',
      'Order Subtotals aggregates UnitPrice * Quantity * (1 - Discount), not total Quantity.',
    ],
  },
} as const;
