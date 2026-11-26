import { createHash } from 'crypto';
import { Message } from 'firebase-admin/messaging';
import { LOCKER_COLLECTION_WINDOW_MS } from '../lockerPushConfig';
import { dispatchLockerReadyPush } from '../services/LockerReadyPush';

const mockSend = jest.fn<Promise<string>, [Message]>();
const mockDevices = {
  listActive: jest.fn(),
  isCurrent: jest.fn(),
  remove: jest.fn(),
};

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ send: mockSend }),
}));
jest.mock('../repositories/PushDeviceRepository', () => ({
  PushDeviceRepository: jest.fn().mockImplementation(() => mockDevices),
}));

// Document keys are paths. For receipt updates, dotted field names are stored
// directly so reads by the same field path observe previous attempts.
const documents = new Map<string, Record<string, unknown>>();
const transaction = {
  get: async (path: string) => ({
    exists: documents.has(path),
    get: (key: string) => documents.get(path)?.[key],
  }),
  create: (path: string, value: Record<string, unknown>) => {
    if (documents.has(path)) throw new Error('Document already exists');
    documents.set(path, { ...value });
  },
  update: (path: string, fields: Record<string, unknown>) => {
    const record = documents.get(path);
    if (!record) throw new Error('Missing document');
    Object.assign(record, fields);
  },
};
const mockRunTransaction = jest.fn(
  (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction),
);
jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {
    collection: (collection: string) => ({ doc: (id: string) => collection + '/' + id }),
    runTransaction: (operation: (tx: typeof transaction) => Promise<unknown>) => mockRunTransaction(operation),
  },
}));

const now = Date.UTC(2026, 10, 25, 12);
const android = { id: 'android', token: 'android-test-token' };
const ios = { id: 'ios', token: 'ios-test-token' };
const notificationId = createHash('sha256').update('locker_ready:shipment').digest('hex');
const receiptPath = 'lockerPushReceipts/' + notificationId;
const originalSetting = process.env.COLLECTION_PUSH_ENABLED;

describe('dispatchLockerReadyPush', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    process.env.COLLECTION_PUSH_ENABLED = 'true';
    documents.clear();
    documents.set('shipments/shipment', {
      orderId: 'order', status: 'en_route', lockerReadyAtMs: now, lockerReadyActive: true,
    });
    documents.set('orders/order', {
      userId: 'buyer', sellerId: 'seller', status: 'shipped',
      shipmentId: 'shipment', paymentStatus: 'succeeded',
    });
    mockDevices.listActive.mockResolvedValue([android]);
    mockDevices.isCurrent.mockResolvedValue(true);
    mockSend.mockResolvedValue('accepted');
  });

  afterEach(() => {
    if (originalSetting === undefined) delete process.env.COLLECTION_PUSH_ENABLED;
    else process.env.COLLECTION_PUSH_ENABLED = originalSetting;
    jest.restoreAllMocks();
  });

  it('uses the buyer’s devices and opens the correct order with a stable notification ID', async () => {
    await dispatchLockerReadyPush('shipment');
    expect(mockDevices.listActive).toHaveBeenCalledWith('buyer');
    expect(mockDevices.isCurrent).toHaveBeenCalledWith('buyer', android);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      token: android.token,
      notification: expect.objectContaining({ title: 'Your parcel is ready to collect' }),
      data: { notificationType: 'locker_ready', entityType: 'order', entityId: 'order', notificationId },
      android: expect.objectContaining({ collapseKey: notificationId }),
      apns: expect.objectContaining({ headers: expect.objectContaining({ 'apns-collapse-id': notificationId }) }),
    }));
  });

  it('ignores a transferred token and never adds newly registered devices on replay', async () => {
    mockDevices.isCurrent.mockResolvedValue(false);
    await dispatchLockerReadyPush('shipment');
    mockDevices.isCurrent.mockResolvedValue(true);
    mockDevices.listActive.mockResolvedValue([android, ios]);
    await dispatchLockerReadyPush('shipment');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('retries only a failed device and suppresses subsequent successful replays', async () => {
    mockDevices.listActive.mockResolvedValue([ios, android]);
    mockSend.mockImplementationOnce(async () => { throw new Error('Provider temporarily unavailable'); });
    await expect(dispatchLockerReadyPush('shipment')).rejects.toThrow();
    await dispatchLockerReadyPush('shipment');
    await dispatchLockerReadyPush('shipment');
    const tokens = mockSend.mock.calls.map(([message]) => 'token' in message && message.token);
    expect(tokens).toEqual([ios.token, android.token, ios.token]);
  });

  it('rejects overlapping sends during a lease and retries after it expires', async () => {
    documents.set(receiptPath, {
      buyerId: 'buyer', orderId: 'order', deviceIds: [android.id],
      ['deliveries.' + android.id]: { attempt: 'existing-attempt', until: now + 100 },
    });
    await expect(dispatchLockerReadyPush('shipment')).rejects.toThrow();
    expect(mockSend).not.toHaveBeenCalled();
    jest.spyOn(Date, 'now').mockReturnValue(now + 101);
    await dispatchLockerReadyPush('shipment');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('skips an order that was collected between listing devices and claiming delivery', async () => {
    mockDevices.listActive.mockImplementationOnce(async () => {
      transaction.update('shipments/shipment', { status: 'delivered', deliveredAt: now });
      return [android];
    });
    await dispatchLockerReadyPush('shipment');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each([
    ['shipments/shipment', { lockerReadyActive: false }],
    ['shipments/shipment', { lockerReadyAtMs: now - LOCKER_COLLECTION_WINDOW_MS }],
    ['orders/order', { buyerConfirmedReceived: true }],
    ['orders/order', { shipmentId: 'different-shipment' }],
  ] as const)('skips ineligible records (%s, %j)', async (path, changes) => {
    transaction.update(path, changes);
    await dispatchLockerReadyPush('shipment');
    expect(mockDevices.listActive).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('performs no reads or sends with the feature disabled', async () => {
    delete process.env.COLLECTION_PUSH_ENABLED;
    await dispatchLockerReadyPush('shipment');
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
