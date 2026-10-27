import { UserRepository } from '../../auth/repositories/UserRepository';
import { EmailService } from '../../notifications/services/EmailService';
import { NotificationService } from '../../notifications/services/NotificationService';
import { ShipmentRepository } from '../../shipping/repositories/ShipmentRepository';
import { ShipmentService } from '../../shipping/services/ShipmentService';
import { Shipment } from '../../shipping/models/Shipment';
import { OrderRepository } from '../repositories/OrderRepository';

export interface ProcessedFulfillment {
  shipment: Shipment | null;
  sendcloudParcel: Awaited<
    ReturnType<ShipmentService['createShipmentForPaidOrder']>
  >['sendcloudParcel'];
  completed: boolean;
}

export class OrderFulfillmentService {
  constructor(
    private readonly orderRepository = new OrderRepository(),
    private readonly shipmentService = new ShipmentService(),
    private readonly shipmentRepository = new ShipmentRepository(),
    private readonly userRepository = new UserRepository(),
    private readonly emailService = new EmailService(),
    private readonly notificationService = new NotificationService(),
  ) {}

  async processPaidOrder(orderId: string): Promise<ProcessedFulfillment> {
    const claim = await this.orderRepository.claimFulfillmentJob(orderId);
    if (claim === 'completed') {
      const shipment =
        await this.shipmentRepository.getShipmentByOrderId(orderId);
      if (!shipment) {
        throw new Error(
          `Completed fulfillment job for order ${orderId} has no shipment`,
        );
      }
      return {
        shipment,
        sendcloudParcel: null,
        completed: true,
      };
    }

    let shipmentCompleted = false;
    try {
      const order = await this.orderRepository.getOrderById(orderId);
      if (!order) {
        throw new Error(`Paid order ${orderId} was not found`);
      }
      if (order.paymentStatus !== 'succeeded') {
        throw new Error(`Order ${orderId} has not been paid`);
      }

      const job = await this.orderRepository.getFulfillmentJob(orderId);
      if (!job) {
        throw new Error(`Fulfillment job for order ${orderId} was not found`);
      }
      shipmentCompleted = job.shipmentCompleted;

      let shipment: Awaited<
        ReturnType<ShipmentService['createShipmentForPaidOrder']>
      >['shipment'];
      let sendcloudParcel: Awaited<
        ReturnType<ShipmentService['createShipmentForPaidOrder']>
      >['sendcloudParcel'] = null;
      let seller: Awaited<ReturnType<UserRepository['getById']>> | undefined;

      if (!job.shipmentCompleted) {
        seller = await this.userRepository.getById(order.sellerId);
        const shipmentResult =
          await this.shipmentService.createShipmentForPaidOrder(order);
        shipment = shipmentResult.shipment;
        sendcloudParcel = shipmentResult.sendcloudParcel;
        await this.orderRepository.updateOrder(orderId, {
          shipmentId: shipment.id,
          shipmentStatus: shipment.status,
          status: 'shipment_created',
        });
        await this.orderRepository.updateFulfillmentJob(orderId, {
          shipmentCompleted: true,
        });
        shipmentCompleted = true;
      } else {
        shipment = await this.shipmentRepository.getShipmentByOrderId(orderId);
        if (!shipment) {
          throw new Error(
            `Fulfillment job for order ${orderId} is missing its shipment`,
          );
        }
      }

      const notificationErrors: unknown[] = [];

      if (!job.sellerNotificationCompleted) {
        try {
          const sellerForNotification =
            seller === undefined
              ? await this.userRepository.getById(order.sellerId)
              : seller;
          if (!sellerForNotification) {
            console.warn(`Seller profile not found for order ${orderId}`);
            await this.orderRepository.updateFulfillmentJob(orderId, {
              sellerEmailStatus: 'failed',
              sellerNotificationCompleted: false,
              labelAttachmentStatus: 'not_available',
              labelAttachmentError: 'Seller profile not found',
              lastSellerEmailAttemptAt: new Date(),
            });
            notificationErrors.push(new Error('Seller profile not found'));
          } else {
            const result = await this.notificationService.sendSellerLabelEmail(
              order,
              sellerForNotification,
              shipment,
            );
            if (result.sent) {
              await this.orderRepository.updateOrder(orderId, {
                sellerSoldEmailSentAt: new Date(),
              });
            }
            await this.orderRepository.updateFulfillmentJob(orderId, {
              sellerEmailStatus: result.sent ? 'sent' : 'skipped',
              labelAttachmentStatus:
                result.labelAttachmentStatus ?? 'not_available',
              labelAttachmentError: result.labelAttachmentError ?? null,
              lastSellerEmailAttemptAt: new Date(),
              sellerNotificationCompleted:
                result.sent || result.skipReason === 'email_disabled',
            });
            if (!result.sent && result.skipReason !== 'email_disabled') {
              notificationErrors.push(
                new Error(result.skipReason ?? 'Seller email was not sent'),
              );
            }
          }
        } catch (error) {
          console.error(`Seller notification failed for order ${orderId}:`, error);
          notificationErrors.push(error);
        }
      }

      if (!job.buyerNotificationCompleted) {
        try {
          const buyer = await this.userRepository.getById(order.userId);
          const result = await this.emailService.sendBuyerShipmentStartedEmail({
            to: order.email,
            buyerName:
              buyer?.firstname || buyer?.displayName || order.shipping.name,
            productName: order.productName,
            orderId,
            trackingNumber: shipment.trackingNumber,
            trackingUrl: shipment.trackingUrl,
          });
          if (result.sent) {
            await this.orderRepository.updateOrder(orderId, {
              buyerShipmentStartedEmailSentAt: new Date(),
            });
          }
          await this.orderRepository.updateFulfillmentJob(orderId, {
            buyerNotificationCompleted: true,
          });
        } catch (error) {
          console.error(`Buyer notification failed for order ${orderId}:`, error);
          notificationErrors.push(error);
        }
      }

      if (notificationErrors.length > 0) {
        throw notificationErrors[0];
      }

      await this.orderRepository.completeFulfillmentJob(orderId);
      return { shipment, sendcloudParcel, completed: true };
    } catch (error) {
      try {
        if (!shipmentCompleted) {
          await this.orderRepository.updateOrder(orderId, {
            shipmentStatus: 'pending',
            status: 'shipment_pending',
          });
        }
        await this.orderRepository.retryFulfillmentJob(orderId, error);
      } catch (retryError) {
        const reason =
          retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(
          `Fulfillment failed and its retry state could not be saved: ${reason}`,
        );
      }
      throw error;
    }
  }
}
