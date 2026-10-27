import { NotificationService } from '../services/NotificationService';
import { Order } from '../../order/model/Order';
import { Shipment } from '../../shipping/models/Shipment';
import { User } from '../../auth/model/User';

describe('NotificationService.sendSellerLabelEmail', () => {
  const order = {
    id: 'order-1',
    productName: 'Winter Coat',
  } as Order;

  const seller = {
    id: 'seller-1',
    email: 'seller@example.com',
    displayName: 'Seller Name',
  } as User;

  const shipment = {
    id: 'shipment-1',
    trackingNumber: 'TRACK123',
    trackingUrl: 'https://track.example/123',
    carrier: 'inpost_gb',
  } as Shipment;

  const createService = (emailEnabled = true) => {
    const emailService = {
      isEnabled: jest.fn().mockReturnValue(emailEnabled),
      sendSellerItemSoldEmail: jest.fn().mockResolvedValue({
        sent: true,
        skipped: false,
      }),
    };
    return {
      emailService,
      service: new NotificationService(emailService as any),
    };
  };

  it('sends the seller sale email without downloading a label', async () => {
    const { service, emailService } = createService();

    const result = await service.sendSellerLabelEmail(order, seller, shipment);

    expect(result).toEqual({
      sent: true,
      skipped: false,
      labelAttachmentStatus: 'not_available',
    });
    expect(emailService.sendSellerItemSoldEmail).toHaveBeenCalledWith({
      to: 'seller@example.com',
      sellerName: 'Seller Name',
      productName: 'Winter Coat',
      orderId: 'order-1',
      idempotencyKey: 'no-label',
      trackingNumber: 'TRACK123',
      trackingUrl: 'https://track.example/123',
      carrier: 'inpost_gb',
      labelAttachment: undefined,
    });
  });

  it('attaches the Sendcloud QR PDF when a shipment document URL exists', async () => {
    const { emailService } = createService();
    const sendcloudService = {
      downloadLabelPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-QR')),
    };
    const service = new NotificationService(
      emailService as any,
      sendcloudService as any,
    );

    await service.sendSellerLabelEmail(order, seller, {
      ...shipment,
      labelUrl:
        'https://panel.sendcloud.sc/api/v2/parcels/732241016/documents/qr',
    });

    expect(sendcloudService.downloadLabelPdf).toHaveBeenCalledWith(
      'https://panel.sendcloud.sc/api/v2/parcels/732241016/documents/qr',
    );
    expect(emailService.sendSellerItemSoldEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        labelAttachment: {
          filename: 'cherry-order-1-shipping-qr.pdf',
          content: Buffer.from('%PDF-QR').toString('base64'),
          contentType: 'application/pdf',
        },
      }),
    );
  });

  it('does not download the label when email is disabled', async () => {
    const { service, emailService } = createService(false);

    const result = await service.sendSellerLabelEmail(order, seller, shipment);

    expect(result).toEqual({
      sent: false,
      skipped: true,
      labelAttachmentStatus: 'not_available',
      skipReason: 'email_disabled',
    });
    expect(emailService.sendSellerItemSoldEmail).not.toHaveBeenCalled();
  });

  it('prefers the seller firstname over displayName', async () => {
    const { service, emailService } = createService();

    await service.sendSellerLabelEmail(order, {
      ...seller,
      firstname: 'Kilo',
    }, shipment);

    expect(emailService.sendSellerItemSoldEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerName: 'Kilo',
      }),
    );
  });
});
