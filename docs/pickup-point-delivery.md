# Pickup-point delivery

This note explains how checkout orders become Sendcloud shipments.

## Current flow

1. `POST /api/order/create` validates the checkout payload and checks the authenticated user.
2. The controller verifies the Stripe PaymentIntent before an order is saved.
3. The order is stored in Firestore with the selected delivery type, shipping method ID, shipping address, payment state, and shipment state.
4. `ShipmentService.createShipmentForPaidOrder` builds a Sendcloud parcel from the saved order.
5. The Sendcloud parcel response is stored as a `shipments` record, then the order is updated with the shipment ID and shipment status.

## Pickup-point branch

For `deliveryMethod = pickup_point`, the backend requires a complete `pickupPoint` object and stores a snapshot of its display fields on the order. This keeps confirmations and support views stable if Sendcloud later changes the service-point record.

The shipment path reuses the same `ShipmentService`. It changes only the destination fields and Sendcloud service-point fields:

- `shipment.id` is resolved from Sendcloud shipping methods or backend config.
- `to_service_point` is set from the selected pickup point ID.
- `address`, `city`, `postal_code`, and `country` use the pickup point snapshot.
- customer name, email, telephone, weight, order number, and label request continue to come from the order.

## Configuration

Set service-point shipping method IDs in environment variables:

```text
SENDCLOUD_PICKUP_POINT_SHIPPING_METHOD_ID=12345
SENDCLOUD_PICKUP_POINT_SHIPPING_METHOD_IDS=inpost_gb=12345,dhl=67890
```

Use `SENDCLOUD_PICKUP_POINT_SHIPPING_METHOD_IDS` when more than one carrier is enabled. The backend may use the selected point's carrier as a hint, but the final shipping method must come from Sendcloud or backend configuration.

Home delivery still uses `shippingMethodId` from checkout, or `SENDCLOUD_HOME_SHIPPING_METHOD_ID` when configured.
