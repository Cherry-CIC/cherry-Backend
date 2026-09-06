import { Order } from '../../order/model/Order';
import { User } from '../../auth/model/User';
import { Shipment } from '../../shipping/models/Shipment';
import { SendcloudService } from '../../shipping/services/SendcloudService';
import { EmailService } from './EmailService';

interface SellerLabelEmailResult {
  sent: boolean;
  skipped: boolean;
}

export class NotificationService {
  constructor(
    private readonly emailService = new EmailService(),
    private readonly sendcloudService = new SendcloudService(),
  ) {}

  async sendSellerLabelEmail(
    order: Order,
    seller: User,
    shipment: Shipment,
  ): Promise<SellerLabelEmailResult> {
    if (!this.emailService.isEnabled()) {
      return { sent: false, skipped: true };
    }

    if (!seller.email) {
      console.warn(`Seller label email skipped: missing seller email`);
      return { sent: false, skipped: true };
    }

    if (!shipment.labelUrl) {
      console.warn(
        `Seller label email skipped for order ${order.id}: missing label URL`,
      );
      return { sent: false, skipped: true };
    }

    const labelPdf = await this.sendcloudService.downloadLabelPdf(
      shipment.labelUrl,
    );

    return this.emailService.sendSellerItemSoldEmail({
      to: seller.email,
      sellerName: seller.displayName,
      productName: order.productName,
      orderId: order.id,
      labelAttachment: {
        filename: `cherry-label-${order.id}.pdf`,
        content: labelPdf.toString('base64'),
        contentType: 'application/pdf',
      },
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      carrier: shipment.carrier,
    });
  }
}
