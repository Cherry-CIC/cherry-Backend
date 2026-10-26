jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {
    collection: jest.fn(),
  },
}));

import { AdminShippingEmailService } from '../services/AdminShippingEmailService';

describe('AdminShippingEmailService.resendSellerEmail', () => {
  it('refreshes the Sendcloud QR URL and resends the seller email', async () => {
    const order = {
      id: 'order-1',
      sellerId: 'seller-1',
      productName: 'Winter Coat',
    };
    const shipment = {
      id: 'shipment-1',
      orderId: 'order-1',
      sendcloudId: 732241016,
      labelUrl: 'https://panel.sendcloud.sc/api/v2/labels/normal_printer/1',
    };
    const seller = { id: 'seller-1', email: 'seller@example.com' };
    const orderRepository = {
      getOrderById: jest.fn().mockResolvedValue(order),
      updateOrder: jest.fn().mockResolvedValue(undefined),
      updateFulfillmentJob: jest.fn().mockResolvedValue(undefined),
    };
    const shipmentRepository = {
      getShipmentByOrderId: jest.fn().mockResolvedValue(shipment),
      updateShipment: jest.fn().mockResolvedValue(undefined),
    };
    const userRepository = {
      getById: jest.fn().mockResolvedValue(seller),
    };
    const sendcloudService = {
      getParcel: jest.fn().mockResolvedValue({
        id: 732241016,
        documents: [
          {
            type: 'qr',
            link:
              'https://panel.sendcloud.sc/api/v2/parcels/732241016/documents/qr',
          },
        ],
      }),
    };
    const notificationService = {
      sendSellerLabelEmail: jest.fn().mockResolvedValue({
        sent: true,
        skipped: false,
        labelAttachmentStatus: 'attached',
      }),
    };

    const service = new AdminShippingEmailService(
      orderRepository as any,
      shipmentRepository as any,
      userRepository as any,
      sendcloudService as any,
      notificationService as any,
    );

    await expect(service.resendSellerEmail('order-1')).resolves.toEqual({
      orderId: 'order-1',
      sent: true,
      labelAttachmentStatus: 'attached',
    });
    expect(shipmentRepository.updateShipment).toHaveBeenCalledWith(
      'shipment-1',
      {
        labelUrl:
          'https://panel.sendcloud.sc/api/v2/parcels/732241016/documents/qr',
      },
    );
    expect(notificationService.sendSellerLabelEmail).toHaveBeenCalledWith(
      order,
      seller,
      expect.objectContaining({
        labelUrl:
          'https://panel.sendcloud.sc/api/v2/parcels/732241016/documents/qr',
      }),
    );
  });
});
