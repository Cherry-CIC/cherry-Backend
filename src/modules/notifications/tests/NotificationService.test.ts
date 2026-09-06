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
    labelUrl: 'https://labels.example/normal.pdf',
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
    const sendcloudService = {
      downloadLabelPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
    };

    return {
      emailService,
      sendcloudService,
      service: new NotificationService(
        emailService as any,
        sendcloudService as any,
      ),
    };
  };

  it('downloads the label and sends it as a PDF attachment', async () => {
    const { service, emailService, sendcloudService } = createService();

    const result = await service.sendSellerLabelEmail(order, seller, shipment);

    expect(result).toEqual({ sent: true, skipped: false });
    expect(sendcloudService.downloadLabelPdf).toHaveBeenCalledWith(
      'https://labels.example/normal.pdf',
    );
    expect(emailService.sendSellerItemSoldEmail).toHaveBeenCalledWith({
      to: 'seller@example.com',
      sellerName: 'Seller Name',
      productName: 'Winter Coat',
      orderId: 'order-1',
      labelAttachment: {
        filename: 'cherry-label-order-1.pdf',
        content: Buffer.from('%PDF').toString('base64'),
        contentType: 'application/pdf',
      },
      trackingNumber: 'TRACK123',
      trackingUrl: 'https://track.example/123',
      carrier: 'inpost_gb',
    });
  });

  it('does not download the label when email is disabled', async () => {
    const { service, emailService, sendcloudService } = createService(false);

    const result = await service.sendSellerLabelEmail(order, seller, shipment);

    expect(result).toEqual({ sent: false, skipped: true });
    expect(sendcloudService.downloadLabelPdf).not.toHaveBeenCalled();
    expect(emailService.sendSellerItemSoldEmail).not.toHaveBeenCalled();
  });

  it('skips when the shipment has no label URL', async () => {
    const { service, emailService, sendcloudService } = createService();

    const result = await service.sendSellerLabelEmail(order, seller, {
      ...shipment,
      labelUrl: null,
    });

    expect(result).toEqual({ sent: false, skipped: true });
    expect(sendcloudService.downloadLabelPdf).not.toHaveBeenCalled();
    expect(emailService.sendSellerItemSoldEmail).not.toHaveBeenCalled();
  });
});
