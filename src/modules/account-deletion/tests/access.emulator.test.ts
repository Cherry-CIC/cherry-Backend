import { readFileSync } from 'fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { admin, firestore } from '../../../shared/config/firebaseConfig';
import express from 'express';
import request from 'supertest';
import { deletionRouter } from '../routes';
import { randomBytes } from 'crypto';

let environment: RulesTestEnvironment;
beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-cherry-deletion',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.deletion.rules', 'utf8'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: readFileSync('storage.deletion.rules', 'utf8'),
    },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
});
afterAll(async () => {
  await environment.cleanup();
  await firestore.terminate();
});

test('rules deny private cross-user data, role injection, guards and all retained evidence', async () => {
  const owner = environment.authenticatedContext('owner');
  const other = environment.authenticatedContext('other');
  await assertSucceeds(
    setDoc(doc(owner.firestore(), 'users/owner'), {
      id: 'owner',
      email: 'owner@example.test',
    }),
  );
  await assertFails(getDoc(doc(other.firestore(), 'users/owner')));
  await assertFails(
    updateDoc(doc(owner.firestore(), 'users/owner'), { admin: true }),
  );
  await assertFails(
    setDoc(doc(owner.firestore(), 'account_deletion_guards/owner'), {
      blocked: false,
    }),
  );
  await assertFails(
    getDoc(doc(owner.firestore(), 'account_retained_orders/o')),
  );
  await assertFails(
    setDoc(doc(owner.firestore(), 'products/p'), { userId: 'other' }),
  );
});

test('guard blocks stale clients, profile recreation, addresses and uploads; ownership prefixes are enforced', async () => {
  const owner = environment.authenticatedContext('owner');
  const db = owner.firestore();
  await assertSucceeds(
    setDoc(doc(db, 'users/owner'), { id: 'owner', email: 'test@example.test' }),
  );
  await assertSucceeds(
    uploadBytes(
      ref(owner.storage(), 'products/owner/a.jpg'),
      new Uint8Array([1]),
      { contentType: 'image/jpeg' },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(owner.storage(), 'products/other/a.jpg'),
      new Uint8Array([1]),
      { contentType: 'image/jpeg' },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(owner.storage(), 'user_images/Sam_profile_picture.png'),
      new Uint8Array([1]),
      { contentType: 'image/png' },
    ),
  );
  await firestore.doc('account_deletion_guards/owner').set({ blocked: true });
  await assertFails(getDoc(doc(db, 'users/owner')));
  await assertFails(
    setDoc(doc(db, 'users/owner'), { id: 'owner', email: 'test@example.test' }),
  );
  await assertFails(
    setDoc(doc(db, 'users/owner/address/shipping'), {
      addressLine1: 'Example',
      city: 'London',
      postcode: 'SW1A 1AA',
      country: 'GB',
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    uploadBytes(
      ref(owner.storage(), 'products/owner/new.jpg'),
      new Uint8Array([1]),
      { contentType: 'image/jpeg' },
    ),
  );
});

test('API derives identity, rejects legacy completion contract and provides private receipt status', async () => {
  const uid = `api-${Date.now()}`;
  const account = await admin.auth().createUser({
    uid,
    email: `${uid}@example.test`,
    password: 'Emulator-only-123!',
  });
  const login = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: account.email,
        password: 'Emulator-only-123!',
        returnSecureToken: true,
      }),
    },
  );
  const { idToken } = (await login.json()) as any;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', deletionRouter);
  const secret = randomBytes(32).toString('base64url');
  const send = () =>
    request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${idToken}`);
  expect((await send()).status).toBe(409);
  expect(
    (
      await send()
        .set('X-Deletion-Contract', '1')
        .set('X-Deletion-Status-Token', secret)
        .send({ uid: 'other' })
    ).status,
  ).toBe(400);
  const result = await send()
    .set('X-Deletion-Contract', '1')
    .set('X-Deletion-Status-Token', secret)
    .send({});
  expect(result.status).toBe(202);
  expect(result.body.data.state).toBe('accepted');
  expect(result.body.data.authenticationDeletedAt).toBeNull();
  const requestId = result.body.data.requestId;
  expect(
    (
      await request(app)
        .post('/api/auth/account/deletion/status')
        .send({ requestId })
    ).status,
  ).toBe(404);
  const status = await request(app)
    .post('/api/auth/account/deletion/status')
    .set('Authorization', `Bearer ${secret}`)
    .send({ requestId });
  expect(status.status).toBe(200);
  expect(JSON.stringify(status.body)).not.toContain(account.email);
  expect(status.headers['cache-control']).toBe('no-store');
  await admin.auth().deleteUser(uid);
  const recovered = await request(app)
    .post('/api/auth/account/deletion/status')
    .set('Authorization', `Bearer ${secret}`)
    .send({});
  expect(recovered.status).toBe(200);
  expect(recovered.body.data.requestId).toBe(requestId);
});
