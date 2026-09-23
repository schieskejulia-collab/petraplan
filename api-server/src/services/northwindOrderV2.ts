type NorthwindOrderEnvelope = {
  source: string;
  customer: { CustomerID: string };
  order: { OrderID: number; CustomerID: string | null; OrderDate: string | null };
  orderDetails: Array<{
    OrderID: number; ProductID: number; Quantity: number; UnitPrice: number; Discount: number;
  }>;
};

/** Structural preview only. The existing order-v1 pipeline still owns decisions. */
export const ORDER_V2_CONTRACT = {
  name: 'order-v2',
  status: 'draft',
  headerFields: ['orderId', 'customerId', 'orderDate', 'status'] as const,
  positionFields: ['orderId', 'productId', 'quantity', 'unitPrice', 'discount'] as const,
  positionIdentity: ['orderId', 'productId'] as const,
  headQuantity: false,
} as const;

export function previewNorthwindOrderV2(envelope: NorthwindOrderEnvelope) {
  const issues: string[] = [];
  const orderId = envelope.order.OrderID;
  if (!Number.isInteger(orderId)) issues.push('order.OrderID is not an integer');
  if (!envelope.order.CustomerID || envelope.order.CustomerID !== envelope.customer.CustomerID) {
    issues.push('order.CustomerID does not identify the supplied customer');
  }
  if (envelope.orderDetails.length === 0) issues.push('No positions were supplied');

  const keys = new Set<string>();
  const positions = envelope.orderDetails.map((detail, index) => {
    const key = `${detail.OrderID}:${detail.ProductID}`;
    if (detail.OrderID !== orderId) issues.push(`Position ${index}: OrderID differs from the header`);
    if (!Number.isInteger(detail.ProductID)) issues.push(`Position ${index}: ProductID is not an integer`);
    if (keys.has(key)) issues.push(`Position ${index}: duplicate OrderID/ProductID`);
    keys.add(key);
    if (!Number.isInteger(detail.Quantity) || detail.Quantity <= 0) {
      issues.push(`Position ${index}: Quantity must be a positive integer`);
    }
    return {
      orderId: detail.OrderID,
      productId: detail.ProductID,
      quantity: detail.Quantity,
      unitPrice: detail.UnitPrice,
      discount: detail.Discount,
      sourcePath: `orderDetails[${index}]`,
    };
  });

  return {
    contract: ORDER_V2_CONTRACT,
    compatible: issues.length === 0,
    issues,
    header: {
      orderId,
      customerId: envelope.order.CustomerID,
      orderDate: envelope.order.OrderDate,
      // ShippedDate is a source fact, not a confirmed status mapping.
      status: null,
      statusEvidence: 'UNPROVEN' as const,
    },
    positions,
    source: envelope.source,
    decision: 'NOT_EVALUATED' as const,
  };
}
