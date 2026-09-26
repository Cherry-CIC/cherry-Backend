/*
 * Local-only integration checks against the real Express app, Firebase Auth
 * verification and Firestore queries. Run through firebase emulators:exec with
 * project demo-cherry-profiles after npm run build. Never supply real accounts.
 */
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

const PROJECT_ID = 'demo-cherry-profiles';
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
assert.equal(projectId, PROJECT_ID, 'The local demo project is required.');
for (const key of [
  'FIREBASE_PROJECT_ID',
  'GCLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT',
]) {
  if (process.env[key]) assert.equal(process.env[key], PROJECT_ID);
}
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  assert.match(
    process.env[key] || '',
    /^127\.0\.0\.1:([1-9]\d{0,4})$/,
    `${key} must explicitly target numeric IPv4 loopback.`,
  );
  const port = Number(process.env[key].split(':')[1]);
  assert.ok(port <= 65535, `${key} must use a valid port.`);
}

// Set inert configuration before importing the app or any Firebase Admin code.
Object.assign(process.env, {
  NODE_ENV: 'production',
  FIREBASE_PROJECT_ID: PROJECT_ID,
  GCLOUD_PROJECT: PROJECT_ID,
  GOOGLE_CLOUD_PROJECT: PROJECT_ID,
  FIREBASE_API_KEY: 'emulator-only-api-key',
  USER_PRODUCTS_CURSOR_KEY: randomBytes(32).toString('base64'),
  STRIPE_SECRET_KEY: 'sk_test_emulator_only',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_emulator_only',
  STRIPE_WEBHOOK_SECRET: 'whsec_emulator_only',
  SENDCLOUD_MODE: 'mock',
  SENDCLOUD_LABEL_MODE: 'test',
  EMAIL_MODE: 'off',
});
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

const request = require('supertest');
const { Timestamp } = require('firebase-admin/firestore');
const app = require('../dist/app').default;
const { admin, firestore } = require('../dist/shared/config/firebaseConfig');

const prefix = `profile-test-${randomBytes(8).toString('hex')}`;
const accounts = new Set();
const documents = new Set();
let responses = 0;

const prohibitedKeys = new Set([
  'email',
  'phone',
  'phonenumber',
  'address',
  'firebaseuid',
  'token',
  'tokens',
  'idtoken',
  'refreshtoken',
  'accesstoken',
  'password',
  'passwordhash',
  'auth',
  'authentication',
  'provider',
  'providerdata',
  'providers',
  'orders',
  'shipments',
  'payments',
  'paymentdata',
  'settings',
  'moderationnotes',
  'firstname',
  'displayname',
]);

function assertPrivateFieldsAbsent(value) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(
      !prohibitedKeys.has(key.toLowerCase()),
      'Private response key found.',
    );
    assertPrivateFieldsAbsent(child);
  }
}

async function writeDocument(collection, name, data) {
  const reference = firestore.collection(collection).doc(`${prefix}-${name}`);
  documents.add(reference.path);
  await reference.set(data);
  return reference.id;
}

async function createAccount(name, options = {}) {
  const uid = `${prefix}-${name}`;
  await admin.auth().createUser({
    uid,
    email: `${name}.${prefix}@example.invalid`,
    password: 'Emulator-only-password-123!',
    ...options,
  });
  accounts.add(uid);
  return uid;
}

async function signIn(uid) {
  const user = await admin.auth().getUser(uid);
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        password: 'Emulator-only-password-123!',
        returnSecureToken: true,
      }),
    },
  );
  assert.equal(response.status, 200, 'Emulator sign-in must succeed.');
  const body = await response.json();
  assert.equal(typeof body.idToken, 'string');
  return body.idToken;
}

async function callApi(path, token, query = {}) {
  const call = request(app)
    .get(path)
    .query(query);
  if (token) call.set('Authorization', `Bearer ${token}`);
  const response = await call;
  responses += 1;
  assertPrivateFieldsAbsent(response.body);
  assert.ok(!JSON.stringify(response.body).includes('PRIVATE_FIXTURE'));
  return response;
}

async function userProfile(uid, token) {
  return callApi(`/api/users/${encodeURIComponent(uid)}/profile`, token);
}

async function userProducts(uid, token, query = {}) {
  return callApi(
    `/api/users/${encodeURIComponent(uid)}/products`,
    token,
    query,
  );
}

function assertProfile(response, uid) {
  assert.equal(response.status, 200, 'User profile request should succeed.');
  const { body } = response;
  assert.deepEqual(Object.keys(body).sort(), ['data', 'success']);
  assert.equal(body.success, true);
  assert.deepEqual(Object.keys(body.data).sort(), [
    'id',
    'profileImageUrl',
    'username',
  ]);
  assert.equal(body.data.id, uid);
  assert.equal(typeof body.data.username, 'string');
  assert.ok(body.data.username.trim().length > 0);
  const avatar = body.data.profileImageUrl;
  assert.ok(
    avatar === null ||
      (typeof avatar === 'string' && /^https?:\/\//.test(avatar)),
  );
}

function assertPage(response, uid, expectedLimit) {
  assert.equal(response.status, 200, 'User products request should succeed.');
  const { body } = response;
  assert.deepEqual(Object.keys(body).sort(), ['data', 'meta', 'success']);
  assert.equal(body.success, true);
  assert.deepEqual(Object.keys(body.data).sort(), ['products']);
  assert.equal(body.meta.limit, expectedLimit);
  assert.equal(typeof body.meta.hasMore, 'boolean');
  assert.ok(Object.hasOwn(body.meta, 'nextCursor'));
  if (body.meta.hasMore) {
    assert.equal(typeof body.meta.nextCursor, 'string');
    assert.ok(body.meta.nextCursor.length > 0);
  } else {
    assert.equal(body.meta.nextCursor, null);
  }
  assert.ok(Array.isArray(body.data.products));
  for (const product of body.data.products) {
    assert.equal(product.userId, uid);
    assert.equal(product.status, 'active');
    assert.ok(!Object.hasOwn(product, 'visibility'));
    for (const key of ['id', 'name', 'quality', 'size', 'postageSize']) {
      assert.equal(typeof product[key], 'string');
      assert.ok(product[key].trim().length > 0);
    }
    assert.equal(typeof product.description, 'string');
    assert.ok(Array.isArray(product.product_images));
    for (const key of ['price', 'donation']) {
      assert.ok(Number.isFinite(product[key]) && product[key] >= 0);
    }
    assert.ok(Number.isInteger(product.likes) && product.likes >= 0);
    assert.ok(Number.isInteger(product.number) && product.number > 0);
  }
}

async function main() {
  const viewer = await createAccount('viewer');
  const secondViewer = await createAccount('viewer-two');
  const seller = await createAccount('seller');
  const emptySeller = await createAccount('empty');
  const legacySeller = await createAccount('legacy');
  const disabledSeller = await createAccount('disabled', { disabled: true });
  const deletedSeller = await createAccount('deleted');
  const [token, otherToken] = await Promise.all([
    signIn(viewer),
    signIn(secondViewer),
  ]);
  const privateFields = {
    email: 'PRIVATE_FIXTURE@example.invalid',
    phone: 'PRIVATE_FIXTURE',
    address: { line1: 'PRIVATE_FIXTURE' },
    firebaseUid: 'PRIVATE_FIXTURE',
    providerData: [{ email: 'PRIVATE_FIXTURE' }],
    tokens: { refreshToken: 'PRIVATE_FIXTURE' },
    orders: [{ paymentData: 'PRIVATE_FIXTURE' }],
    shipments: [{ address: 'PRIVATE_FIXTURE' }],
    moderationNotes: 'PRIVATE_FIXTURE',
  };
  await writeDocument('users', 'seller', {
    id: seller,
    username: 'Alex',
    profileImageUrl: 'https://example.invalid/avatar.jpg',
    ...privateFields,
    firebaseUid: seller,
  });
  await writeDocument('users', 'seller-linked-profile', {
    id: seller,
    username: 'Older safe name',
    displayName: 'PRIVATE_FIXTURE full name',
    ...privateFields,
    firebaseUid: seller,
  });
  for (const [name, uid] of [
    ['empty', emptySeller],
    ['disabled', disabledSeller],
    ['deleted', deletedSeller],
  ]) {
    await writeDocument('users', name, { id: uid, username: 'Test seller' });
  }
  await writeDocument('users', 'legacy-generated-document', {
    id: legacySeller,
    username: 'Legacy visible seller',
    photoURL: 'https://example.invalid/legacy-avatar.jpg',
    ...privateFields,
    firebaseUid: legacySeller,
  });
  await admin.auth().deleteUser(deletedSeller);
  accounts.delete(deletedSeller);

  const seconds = 1789900000;
  const baseProduct = {
    userId: seller,
    name: 'Blue cotton shirt',
    description: 'A fictional emulator listing.',
    quality: 'Good',
    product_images: ['https://example.invalid/shirt.jpg'],
    donation: 10,
    price: 11,
    securityFee: 1,
    likes: 0,
    number: 1,
    size: 'M',
    postageSize: 'small-parcel',
    categoryId: 'shirts',
    charityId: 'fictional-charity',
    status: 'active',
    createdAt: new Timestamp(seconds, 0),
    ...privateFields,
    category: { name: 'Shirts', orders: ['PRIVATE_FIXTURE'] },
    charity: { name: 'Test charity', address: 'PRIVATE_FIXTURE' },
  };
  // Equal timestamps exercise the document-ID tie-break. Sub-millisecond
  // timestamps detect lossy cursor serialisation through Date/toMillis.
  const visibleFixtures = [
    ['visible-a', new Timestamp(seconds, 100)],
    ['visible-b', new Timestamp(seconds, 100)],
    ['visible-c', new Timestamp(seconds, 101)],
    ['visible-d', new Timestamp(seconds - 1, 999999999)],
    ['visible-e', new Timestamp(seconds - 2, 0)],
  ];
  for (const [name, createdAt] of visibleFixtures) {
    await writeDocument('products', name, { ...baseProduct, createdAt });
  }
  const exclusions = [
    ['zero-stock', { number: 0 }],
    ['sold', { status: 'sold' }],
    ['unlisted', { status: 'unlisted' }],
    ['deleted', { deleted: true }],
    ['removed', { status: 'removed' }],
    ['hidden', { moderationStatus: 'hidden' }],
    ['unknown-moderation', { moderationStatus: 'unknown' }],
    ['private', { visibility: 'private' }],
    ['unknown-visibility', { visibility: 'unknown' }],
    ['wrong-owner', { userId: secondViewer }],
    ['anonymised', { userId: 'deleted_user' }],
  ];
  for (const [name, changes] of exclusions) {
    await writeDocument('products', name, {
      ...baseProduct,
      createdAt: new Timestamp(seconds + 1, 0),
      ...changes,
    });
  }
  // Force scanning across several source pages full of excluded stock records.
  const stockBatch = firestore.batch();
  for (let index = 0; index < 110; index += 1) {
    const reference = firestore
      .collection('products')
      .doc(`${prefix}-stock-${index}`);
    documents.add(reference.path);
    stockBatch.set(reference, {
      ...baseProduct,
      number: 0,
      createdAt: new Timestamp(seconds + 2, index),
    });
  }
  await stockBatch.commit();

  assert.equal((await userProfile(seller)).status, 401);
  assert.equal((await userProfile(seller, 'not-a-firebase-token')).status, 401);
  for (const limit of [0, 51, 1.5, 'invalid']) {
    assert.equal((await userProducts(seller, token, { limit })).status, 400);
  }
  const profileResponse = await userProfile(seller, token);
  assertProfile(profileResponse, seller);
  assert.equal(profileResponse.body.data.username, 'Alex');
  const defaultPage = await userProducts(seller, token);
  assertPage(defaultPage, seller, 20);
  assert.equal(defaultPage.body.data.products.length, visibleFixtures.length);
  for (const product of defaultPage.body.data.products) {
    assert.equal(
      product.securityFee,
      1.1,
      'Use the existing security-fee calculation.',
    );
  }
  assert.equal(defaultPage.body.meta.hasMore, false);
  assertPage(await userProducts(seller, token, { limit: 50 }), seller, 50);
  const firstPage = await userProducts(seller, token, { limit: 1 });
  assertPage(firstPage, seller, 1);
  const firstCursor = firstPage.body.meta.nextCursor;
  assert.ok(firstCursor, 'Several listings require a second page.');
  const expectedIds = [
    'visible-c',
    'visible-b',
    'visible-a',
    'visible-d',
    'visible-e',
  ].map((name) => `${prefix}-${name}`);
  const observedIds = [];
  let cursor;
  do {
    const response = await userProducts(seller, token, {
      limit: 1,
      ...(cursor && { cursor }),
    });
    assertPage(response, seller, 1);
    assert.equal(response.body.data.products.length, 1);
    observedIds.push(response.body.data.products[0].id);
    const nextCursor = response.body.meta.nextCursor;
    assert.ok(!nextCursor || nextCursor !== cursor, 'Cursor must advance.');
    assert.ok(
      observedIds.length <= expectedIds.length,
      'Pagination must terminate.',
    );
    cursor = nextCursor;
  } while (cursor);
  assert.deepEqual(observedIds, expectedIds);

  for (const [uid, bearer, invalidCursor] of [
    [emptySeller, token, firstCursor],
    [seller, otherToken, firstCursor],
    [seller, token, 'malformed-cursor'],
    [seller, token, `${firstCursor.slice(0, -1)}!`],
  ]) {
    assert.equal(
      (await userProducts(uid, bearer, { cursor: invalidCursor })).status,
      400,
    );
  }
  const empty = await userProducts(emptySeller, token);
  assertPage(empty, emptySeller, 20);
  assert.deepEqual(empty.body.data.products, []);
  const legacyProfile = await userProfile(legacySeller, token);
  assertProfile(legacyProfile, legacySeller);
  assert.equal(legacyProfile.body.data.username, 'Legacy visible seller');
  const legacy = await userProducts(legacySeller, token);
  assertPage(legacy, legacySeller, 20);
  for (const uid of [disabledSeller, deletedSeller, `${prefix}-missing`]) {
    const response = await userProfile(uid, token);
    assert.ok([404, 410].includes(response.status));
    assert.ok(!response.body.data);
  }
  assert.equal((await userProfile('deleted_user', token)).status, 400);

  const docs = await request(app).get('/api-docs/swagger-ui-init.js');
  assert.equal(docs.status, 200);
  for (const schema of [
    '/api/users/{userId}/profile',
    '/api/users/{userId}/products',
    'UserProfile',
    'UserProduct',
  ]) {
    assert.ok(docs.text.includes(schema), 'Swagger contract missing.');
  }
  assert.equal(responses, 26, 'All API scenarios must run.');
  console.log(
    `User profile/products emulator checks passed: ${responses} API responses.`,
  );
}

async function cleanup() {
  const references = [...documents];
  for (let index = 0; index < references.length; index += 400) {
    const batch = firestore.batch();
    for (const path of references.slice(index, index + 400)) {
      assert.ok(path.split('/')[1].startsWith(`${prefix}-`));
      batch.delete(firestore.doc(path));
    }
    await batch.commit();
  }
  if (accounts.size) {
    const result = await admin.auth().deleteUsers([...accounts]);
    assert.equal(result.failureCount, 0, 'Fixture account cleanup failed.');
  }
  await admin.app().delete();
}

main()
  .catch((error) => {
    // Do not print assertion operands, tokens or backend exception bodies.
    const location = String(error?.stack || '').match(
      /test-user-profile-products-emulator\.js:\d+:\d+/,
    )?.[0];
    console.error(
      `User profile/products emulator integration failed${location ? ` at ${location}` : ''}.`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (_) {
      console.error(
        'Local emulator fixture cleanup failed. Stop the emulator to discard its data.',
      );
      process.exitCode = 1;
    }
  });
