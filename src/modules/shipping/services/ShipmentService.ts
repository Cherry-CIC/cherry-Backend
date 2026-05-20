import { Order } from '../../order/model/Order';
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { SendcloudService } from './SendcloudService';
import {
  resolveConfiguredPickupPointShippingMethod,
  resolveHomeShippingMethodId,
} from './shippingMethodResolver';

export class ShipmentService {
  constructor(
    private readonly shipmentRepository = new ShipmentRepository(),
    private readonly sendcloudService = new SendcloudService()
  ) {}

  async createShipmentForPaidOrder(order: Order): Promise<{
    shipment: any;
    sendcloudParcel: any;
  }> {
    const existingShipment = await this.shipmentRepository.getShipmentByOrderId(order.id);
    if (existingShipment) {
      return { shipment: existingShipment, sendcloudParcel: null };
    }

    const shippingMethodId = this.resolveShippingMethodId(order);
    const numericShippingMethodId = Number(shippingMethodId);
    if (!Number.isInteger(numericShippingMethodId) || numericShippingMethodId <= 0) {
      throw new Error('Sendcloud shipping method ID must be numeric');
    }
    const destinationAddress =
      order.deliveryType === 'pickup_point'
        ? this.getPickupPointDestination(order)
        : {
            address: order.shipping.address.line1,
            city: order.shipping.address.city,
            postal_code: order.shipping.address.postal_code,
            country: order.shipping.address.country || 'GB',
          };

    const parcelData: any = {
      name: order.shipping.name || 'Customer',
      address: destinationAddress.address,
      house_number: order.shipping.address.house_number || '',
      city: destinationAddress.city,
      postal_code: destinationAddress.postal_code,
      country: destinationAddress.country,
      email: order.email,
      telephone: order.shipping.telephone || '',
      order_number: order.id,
      weight: (order.shippingWeight / 1000).toFixed(3),
      request_label: true,
      shipment: {
        id: numericShippingMethodId,
      },
    };

    if (order.deliveryType === 'pickup_point' && order.pickupPoint) {
      parcelData.to_service_point = this.toServicePointId(order.pickupPoint.id);
      console.log('Creating Sendcloud service-point shipment:', {
        orderId: order.id,
        deliveryType: order.deliveryType,
        pickupPointId: order.pickupPoint.id,
        resolvedCarrier: order.shippingCarrier || order.pickupPoint.carrier || null,
        shippingMethodId,
      });
    } else {
      console.log('Creating Sendcloud home shipment:', {
        orderId: order.id,
        deliveryType: order.deliveryType,
        resolvedCarrier: order.shippingCarrier || null,
        shippingMethodId,
      });
    }

    let sendcloudParcel: any;
    try {
      sendcloudParcel = await this.sendcloudService.createParcel(parcelData);
    } catch (err) {
      console.error('Sendcloud shipment creation failed:', {
        orderId: order.id,
        deliveryType: order.deliveryType,
        pickupPointId: order.pickupPoint?.id,
        resolvedCarrier: order.shippingCarrier || order.pickupPoint?.carrier || null,
        shippingMethodId,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      throw err;
    }

    const shipment = await this.shipmentRepository.createShipment({
      orderId: order.id,
      deliveryType: order.deliveryType,
      shippingOptionId: shippingMethodId,
      provider: 'sendcloud',
      checkoutIdentifier: shippingMethodId,
      pickupPoint: order.pickupPoint,
      sendcloudId: sendcloudParcel.id,
      trackingNumber: sendcloudParcel.tracking_number ?? null,
      trackingUrl: sendcloudParcel.tracking_url ?? null,
      carrier: sendcloudParcel.carrier?.name ?? order.shippingCarrier ?? null,
      status: 'announced',
      labelUrl: sendcloudParcel.label?.label_printer ?? null,
      parcel: parcelData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { shipment, sendcloudParcel };
  }

  private resolveShippingMethodId(order: Order): string {
    if (order.deliveryType === 'pickup_point') {
      const configuredMethod = resolveConfiguredPickupPointShippingMethod(
        order.shippingCarrier || order.pickupPoint?.carrier,
      );
      const methodId = String(
        configuredMethod?.id || order.shippingOptionId || '',
      ).trim();

      if (!methodId) {
        throw new Error(
          'No Sendcloud service-point shipping method is configured for pickup-point delivery',
        );
      }

      return methodId;
    }

    const homeMethodId = resolveHomeShippingMethodId(order.shippingOptionId);
    if (!homeMethodId) {
      throw new Error('No Sendcloud shipping method is configured for home delivery');
    }

    return homeMethodId;
  }

  private getPickupPointDestination(order: Order): {
    address: string;
    city: string;
    postal_code: string;
    country: string;
  } {
    const pickupPoint = order.pickupPoint;

    if (!pickupPoint) {
      throw new Error('Pickup-point delivery requires a selected pickup point');
    }

    const requiredFields = [
      pickupPoint.id,
      pickupPoint.name,
      pickupPoint.addressLine1,
      pickupPoint.city,
      pickupPoint.postalCode,
      pickupPoint.country,
    ];

    if (requiredFields.some((value) => !String(value || '').trim())) {
      throw new Error('Pickup-point delivery requires a complete pickup point');
    }

    return {
      address: pickupPoint.addressLine1,
      city: pickupPoint.city,
      postal_code: pickupPoint.postalCode,
      country: pickupPoint.country,
    };
  }

  private toServicePointId(servicePointId: string): string | number {
    const numericServicePointId = Number(servicePointId);
    return Number.isInteger(numericServicePointId) && numericServicePointId > 0
      ? numericServicePointId
      : servicePointId;
  }
}
