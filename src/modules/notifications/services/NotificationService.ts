import { Order } from '../../order/model/Order';
import { User } from '../../auth/model/User';
import { Shipment } from '../../shipping/models/Shipment';
import { EmailService } from './EmailService';
import { SendcloudService } from '../../shipping/services/SendcloudService';

interface SellerLabelEmailResult {
  sent: boolean;
  skipped: boolean;
  labelAttachmentStatus: 'attached' | 'failed' | 'not_available';
  labelAttachmentError?: string;
  skipReason?: 'email_disabled' | 'missing_seller_email';
}

export class NotificationService {
  constructor(
    private readonly emailService = new EmailService(),
    private readonly sendcloudService?: SendcloudService,
  ) {}

  async sendSellerLabelEmail(
    order: Order,
    seller: User,
    shipment: Shipment,
  ): Promise<SellerLabelEmailResult> {
    if (!this.emailService.isEnabled()) {
      return {
        sent: false,
        skipped: true,
        labelAttachmentStatus: 'not_available',
        skipReason: 'email_disabled',
      };
    }

    if (!seller.email) {
      console.warn(`Seller label email skipped: missing seller email`);
      return {
        sent: false,
        skipped: true,
        labelAttachmentStatus: 'not_available',
        skipReason: 'missing_seller_email',
      };
    }

    let labelAttachment:
      | {
          filename: string;
          content: string;
          contentType: string;
        }
      | undefined;
    let labelAttachmentStatus: SellerLabelEmailResult['labelAttachmentStatus'] =
      'not_available';
    let labelAttachmentError: string | undefined;

    if (shipment.labelUrl) {
      try {
        const pdf = await (
          this.sendcloudService ?? new SendcloudService()
        ).downloadLabelPdf(shipment.labelUrl);
        labelAttachment = {
          filename: `cherry-${order.id}-shipping-qr.pdf`,
          content: pdf.toString('base64'),
          contentType: 'application/pdf',
        };
        labelAttachmentStatus = 'attached';
      } catch (error) {
        labelAttachmentStatus = 'failed';
        labelAttachmentError =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `Seller shipping document attachment skipped for order ${order.id}:`,
          error,
        );
      }
    }

    const result = await this.emailService.sendSellerItemSoldEmail({
      to: seller.email,
      sellerName: seller.firstname || seller.displayName,
      productName: order.productName,
      orderId: order.id,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      carrier: shipment.carrier,
      labelAttachment,
      idempotencyKey: shipment.labelUrl ?? 'no-label',
    });

    return {
      ...result,
      labelAttachmentStatus,
      ...(labelAttachmentError ? { labelAttachmentError } : {}),
    };
  }
}
