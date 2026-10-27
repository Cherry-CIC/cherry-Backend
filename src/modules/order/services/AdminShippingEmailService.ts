import { firestore } from '../../../shared/config/firebaseConfig';
import { UserRepository } from '../../auth/repositories/UserRepository';
import { NotificationService } from '../../notifications/services/NotificationService';
import { SendcloudService } from '../../shipping/services/SendcloudService';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';
import { OrderRepository } from '../repositories/OrderRepository';

export class AdminShippingEmailService {
  constructor(
    private readonly orderRepository = new OrderRepository(),
    private readonly shipmentRepository = new ShipmentRepository(),
    private readonly userRepository = new UserRepository(),
    private readonly sendcloudService = new SendcloudService(),
    private readonly notificationService = new NotificationService(),
  ) {}

  async listIssues(): Promise<any[]> {
    const snapshot = await firestore
      .collection('order_fulfillment_jobs')
      .get();

    const issues = snapshot.docs
      .map((doc) => ({ orderId: doc.id, ...doc.data() }))
      .filter((job: any) =>
        ['failed', 'pending'].includes(job.labelAttachmentStatus),
      );

    return Promise.all(
      issues.map(async (job: any) => {
        const [order, shipment] = await Promise.all([
          this.orderRepository.getOrderById(job.orderId),
          this.shipmentRepository.getShipmentByOrderId(job.orderId),
        ]);

        return {
          orderId: job.orderId,
          productName: order?.productName ?? null,
          sellerId: order?.sellerId ?? null,
          sellerEmailStatus: job.sellerEmailStatus ?? null,
          labelAttachmentStatus: job.labelAttachmentStatus,
          labelAttachmentError: job.labelAttachmentError ?? null,
          lastSellerEmailAttemptAt: job.lastSellerEmailAttemptAt ?? null,
          shipmentId: shipment?.id ?? null,
          trackingNumber: shipment?.trackingNumber ?? null,
        };
      }),
    );
  }

  async resendSellerEmail(orderId: string): Promise<{
    orderId: string;
    sent: boolean;
    labelAttachmentStatus: string;
  }> {
    const order = await this.orderRepository.getOrderById(orderId);
    const [shipment, seller] = order
      ? await Promise.all([
          this.shipmentRepository.getShipmentByOrderId(orderId),
          this.userRepository.getById(order.sellerId),
        ])
      : [null, null];

    if (!order || !shipment || !seller) {
      throw new Error('Order, shipment, or seller could not be found');
    }
    if (!shipment.sendcloudId) {
      throw new Error('Shipment has no Sendcloud parcel ID');
    }

    const parcel = await this.sendcloudService.getParcel(shipment.sendcloudId);
    const qrDocument = parcel.documents?.find(
      (document) => document.type === 'qr' && document.link,
    );
    if (!qrDocument?.link) {
      throw new Error('Sendcloud did not return a QR document for this parcel');
    }

    const result = await this.notificationService.sendSellerLabelEmail(
      order,
      seller,
      { ...shipment, labelUrl: qrDocument.link },
    );

    await this.shipmentRepository.updateShipment(shipment.id, {
      labelUrl: qrDocument.link,
    });

    await this.orderRepository.updateFulfillmentJob(orderId, {
      sellerEmailStatus: result.sent ? 'sent' : 'skipped',
      labelAttachmentStatus: result.labelAttachmentStatus,
      labelAttachmentError: result.labelAttachmentError ?? null,
      lastSellerEmailAttemptAt: new Date(),
      sellerNotificationCompleted: result.sent,
    });

    if (result.sent) {
      await this.orderRepository.updateOrder(orderId, {
        sellerSoldEmailSentAt: new Date(),
      });
    }

    return {
      orderId,
      sent: result.sent,
      labelAttachmentStatus: result.labelAttachmentStatus,
    };
  }
}
