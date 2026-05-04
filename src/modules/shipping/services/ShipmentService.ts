import { Order } from '../../order/model/Order';
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { SendcloudService } from './SendcloudService';

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

    const parcelData: any = {
      name: order.shipping.name || 'Customer',
      address: order.shipping.address.line1,
      house_number: order.shipping.address.house_number || '',
      city: order.shipping.address.city,
      postal_code: order.shipping.address.postal_code,
      country: order.shipping.address.country || 'GB',
      email: order.email,
      telephone: order.shipping.telephone || '',
      order_number: order.id,
      weight: (order.shippingWeight / 1000).toFixed(3),
      request_label: true,
      shipment: {
        id: Number(order.shippingOptionId),
      },
    };

    if (order.deliveryType === 'pickup_point' && order.pickupPoint) {
      parcelData.to_service_point = Number(order.pickupPoint.id);
    }

    const sendcloudParcel = await this.sendcloudService.createParcel(parcelData);

    const shipment = await this.shipmentRepository.createShipment({
      orderId: order.id,
      deliveryType: order.deliveryType,
      shippingOptionId: order.shippingOptionId,
      provider: 'sendcloud',
      checkoutIdentifier: order.shippingOptionId,
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
}
