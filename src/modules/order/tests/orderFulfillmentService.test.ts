import { Order } from '../model/Order';
import { FulfillmentJob } from '../model/FulfillmentJob';
import { Shipment } from '../../shipping/models/Shipment';
import { OrderFulfillmentService } from '../services/OrderFulfillmentService';

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {},
}));

describe('OrderFulfillmentService', () => {
  const order: Order = {
    id: 'order-1',
    userId: 'buyer-1',
    sellerId: 'seller-1',
    charityId: 'charity-1',
    email: 'buyer@example.com',
    productAmount: 2500,
    shippingFee: 399,
    securityFee: 250,
    totalAmount: 3149,
    currency: 'GBP',
    productId: 'product-1',
    productName: 'Winter Coat',
    deliveryType: 'pickup_point',
    shippingOptionId: '3747',
    shippingOptionName: 'InPost locker',
    shippingCarrier: 'inpost_gb',
    shippingWeight: 2000,
    shipping: {
      name: 'Buyer Name',
      telephone: '+447700900000',
      address: {
        line1: '10 High Street',
        city: 'London',
        postal_code: 'SW1A 1AA',
        country: 'GB',
      },
    },
    pickupPoint: {
      id: '999',
      name: 'Locker A',
      addressLine1: '10 High Street',
      city: 'London',
      postalCode: 'SW1A 1AA',
      country: 'GB',
    },
    paymentIntentId: 'pi_123',
    paymentStatus: 'succeeded',
    status: 'paid',
    shipmentStatus: 'pending',
    createdAt: new Date(),
  };

  const shipment: Shipment = {
    id: 'shipment-1',
    orderId: order.id,
    status: 'announced',
    parcel: {
      name: 'Buyer Name',
      address: '10 High Street',
      city: 'London',
      postal_code: 'SW1A 1AA',
      country: 'GB',
      weight: 2,
      order_number: order.id,
    },
    trackingNumber: 'TRACK123',
    trackingUrl: 'https://tracking.example/123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createService = (job: FulfillmentJob) => {
    const orderRepository = {
      claimFulfillmentJob: jest.fn().mockResolvedValue('claimed'),
      getOrderById: jest.fn().mockResolvedValue(order),
      getFulfillmentJob: jest.fn().mockImplementation(async () => ({ ...job })),
      updateOrder: jest.fn().mockResolvedValue(undefined),
      updateFulfillmentJob: jest
        .fn()
        .mockImplementation(async (_orderId, updates) =>
          Object.assign(job, updates),
        ),
      retryFulfillmentJob: jest.fn().mockResolvedValue(undefined),
      completeFulfillmentJob: jest.fn().mockResolvedValue(undefined),
    };
    const shipmentService = {
      createShipmentForPaidOrder: jest.fn().mockResolvedValue({
        shipment,
        sendcloudParcel: { id: 99 },
      }),
    };
    const shipmentRepository = {
      getShipmentByOrderId: jest.fn().mockResolvedValue(shipment),
    };
    const userRepository = {
      getById: jest
        .fn()
        .mockImplementation(async (userId: string) =>
          userId === 'seller-1'
            ? { id: userId, email: 'seller@example.com' }
            : { id: userId, firstname: 'Buyer' },
        ),
    };
    const emailService = {
      sendBuyerShipmentStartedEmail: jest.fn().mockResolvedValue({
        sent: true,
        skipped: false,
      }),
    };
    const notificationService = {
      sendSellerLabelEmail: jest.fn().mockResolvedValue({
        sent: true,
        skipped: false,
      }),
    };

    return {
      orderRepository,
      shipmentService,
      shipmentRepository,
      userRepository,
      emailService,
      notificationService,
      service: new OrderFulfillmentService(
        orderRepository as any,
        shipmentService as any,
        shipmentRepository as any,
        userRepository as any,
        emailService as any,
        notificationService as any,
      ),
    };
  };

  const pendingJob = (): FulfillmentJob => ({
    orderId: order.id,
    status: 'processing',
    attempts: 1,
    shipmentCompleted: false,
    sellerNotificationCompleted: false,
    buyerNotificationCompleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('creates shipment, sends notifications, and completes the job', async () => {
    const dependencies = createService(pendingJob());

    const result = await dependencies.service.processPaidOrder(order.id);

    expect(result).toEqual({
      shipment,
      sendcloudParcel: { id: 99 },
      completed: true,
    });
    expect(
      dependencies.shipmentService.createShipmentForPaidOrder,
    ).toHaveBeenCalledWith(order);
    expect(
      dependencies.orderRepository.updateFulfillmentJob,
    ).toHaveBeenCalledWith(order.id, { shipmentCompleted: true });
    expect(
      dependencies.notificationService.sendSellerLabelEmail,
    ).toHaveBeenCalled();
    expect(
      dependencies.emailService.sendBuyerShipmentStartedEmail,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        to: order.email,
        buyerName: 'Buyer',
        orderId: order.id,
      }),
    );
    expect(
      dependencies.orderRepository.completeFulfillmentJob,
    ).toHaveBeenCalledWith(order.id);
  });

  it('retries a failed notification without recreating the shipment', async () => {
    const job = pendingJob();
    const dependencies = createService(job);
    dependencies.emailService.sendBuyerShipmentStartedEmail
      .mockRejectedValueOnce(new Error('Email provider unavailable'))
      .mockResolvedValueOnce({ sent: true, skipped: false });

    await expect(
      dependencies.service.processPaidOrder(order.id),
    ).rejects.toThrow('Email provider unavailable');

    expect(
      dependencies.orderRepository.retryFulfillmentJob,
    ).toHaveBeenCalledWith(order.id, expect.any(Error));
    expect(job).toEqual(
      expect.objectContaining({
        shipmentCompleted: true,
        sellerNotificationCompleted: true,
        buyerNotificationCompleted: false,
      }),
    );

    const result = await dependencies.service.processPaidOrder(order.id);

    expect(result.completed).toBe(true);
    expect(
      dependencies.shipmentService.createShipmentForPaidOrder,
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.notificationService.sendSellerLabelEmail,
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.emailService.sendBuyerShipmentStartedEmail,
    ).toHaveBeenCalledTimes(2);
    expect(
      dependencies.shipmentRepository.getShipmentByOrderId,
    ).toHaveBeenCalledWith(order.id);
  });

  it('still sends the buyer email when the seller email fails', async () => {
    const job = pendingJob();
    const dependencies = createService(job);
    dependencies.notificationService.sendSellerLabelEmail.mockRejectedValueOnce(
      new Error('Seller email unavailable'),
    );

    await expect(
      dependencies.service.processPaidOrder(order.id),
    ).rejects.toThrow('Seller email unavailable');

    expect(
      dependencies.emailService.sendBuyerShipmentStartedEmail,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        to: order.email,
        orderId: order.id,
      }),
    );
    expect(job).toEqual(
      expect.objectContaining({
        shipmentCompleted: true,
        sellerNotificationCompleted: false,
        buyerNotificationCompleted: true,
      }),
    );
  });
});
