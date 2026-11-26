import { createHash, randomUUID } from 'crypto';
import { getMessaging, Message } from 'firebase-admin/messaging';
import { firestore } from '../../../shared/config/firebaseConfig';
import { isLockerPushEnabled, LOCKER_COLLECTION_WINDOW_MS } from '../lockerPushConfig';
import { PushDeviceRepository } from '../repositories/PushDeviceRepository';

const LEASE_MS = 2 * 60 * 1000;

interface Arrival {
  buyerId: string;
  orderId: string;
  expiresAt: number;
}

type Device = { id: string; token: string };

async function readArrival(tx: FirebaseFirestore.Transaction, shipmentId: string): Promise<Arrival | null> {
  const shipment = await tx.get(firestore.collection('shipments').doc(shipmentId));
  const at = shipment.get('lockerReadyAtMs');
  const now = Date.now();
  if (shipment.get('lockerReadyActive') !== true || shipment.get('status') !== 'en_route' ||
      shipment.get('deliveredAt') || !Number.isFinite(at) || at > now ||
      at + LOCKER_COLLECTION_WINDOW_MS <= now) return null;

  const orderId = shipment.get('orderId');
  const order = await tx.get(firestore.collection('orders').doc(orderId));
  const buyerId = order.get('userId');
  if (!buyerId || buyerId === 'deleted_user' || order.get('paymentStatus') !== 'succeeded' ||
      order.get('status') !== 'shipped' || order.get('shipmentId') !== shipmentId ||
      order.get('buyerConfirmedReceived') || order.get('buyerDisputeStatus')) return null;
  return { buyerId, orderId, expiresAt: at + LOCKER_COLLECTION_WINDOW_MS };
}

function buildMessage(token: string, arrival: Arrival, notificationId: string): Message {
  // A short transport lifetime limits delayed alerts on offline devices.
  const ttl = Math.max(0, Math.min(15 * 60 * 1000, arrival.expiresAt - Date.now()));
  return {
    token,
    notification: {
      title: 'Your parcel is ready to collect',
      body: 'Check your InPost email for your collection code.',
    },
    data: { notificationType: 'locker_ready', entityType: 'order', entityId: arrival.orderId, notificationId },
    android: { priority: 'high', ttl, collapseKey: notificationId, notification: { tag: notificationId } },
    apns: {
      headers: { 'apns-collapse-id': notificationId, 'apns-expiration': String(Math.floor((Date.now() + ttl) / 1000)) },
      payload: { aps: { sound: 'default' } },
    },
  };
}

export async function dispatchLockerReadyPush(shipmentId: string): Promise<void> {
  if (!isLockerPushEnabled()) return;
  const arrival = await firestore.runTransaction(tx => readArrival(tx, shipmentId));
  if (!arrival) return;

  const devices = new PushDeviceRepository();
  const active = await devices.listActive(arrival.buyerId);
  const notificationId = createHash('sha256').update('locker_ready:' + shipmentId).digest('hex');
  const receipt = firestore.collection('lockerPushReceipts').doc(notificationId);

  // Freeze the audience on the first attempt. A repeated webhook must never
  // notify a device added after this arrival was handled.
  const targets: string[] = await firestore.runTransaction(async tx => {
    const saved = await tx.get(receipt);
    if (saved.exists) {
      return saved.get('buyerId') === arrival.buyerId && saved.get('orderId') === arrival.orderId
        ? saved.get('deviceIds') : [];
    }
    const current = await readArrival(tx, shipmentId);
    if (!current || current.buyerId !== arrival.buyerId || current.orderId !== arrival.orderId) return [];
    const deviceIds = active.map(device => device.id);
    tx.create(receipt, { buyerId: arrival.buyerId, orderId: arrival.orderId, deviceIds, deliveries: {}, createdAt: new Date() });
    return deviceIds;
  });

  async function sendToDevice(device: Device, expected: Arrival): Promise<void> {
    const attempt = randomUUID();
    const field = 'deliveries.' + device.id;
    const claimed = await firestore.runTransaction(async tx => {
      const saved = await tx.get(receipt);
      const previous = saved.get(field);
      if (previous === 'finished') return false;
      if (previous?.until > Date.now()) throw new Error('Locker push already in progress');
      const current = await readArrival(tx, shipmentId);
      if (!current || current.buyerId !== expected.buyerId || current.orderId !== expected.orderId) return false;
      tx.update(receipt, { [field]: { attempt, until: Date.now() + LEASE_MS } });
      return true;
    });
    if (!claimed) return;

    let retry = false;
    try {
      if (await devices.isCurrent(expected.buyerId, device)) {
        await getMessaging().send(buildMessage(device.token, expected, notificationId));
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        await devices.remove(expected.buyerId, device.token);
      } else {
        retry = true;
      }
    }
    await firestore.runTransaction(async tx => {
      const saved = await tx.get(receipt);
      if (saved.get(field)?.attempt === attempt) tx.update(receipt, { [field]: retry ? null : 'finished' });
    });
    if (retry) throw new Error('Locker push delivery needs a retry');
  }

  const results = await Promise.allSettled(
    active.filter(device => targets.includes(device.id)).map(device => sendToDevice(device, arrival)),
  );
  // Sendcloud can retry the signed webhook. Successful devices retain receipts.
  if (results.some(result => result.status === 'rejected')) throw new Error('Locker push delivery incomplete');
}
