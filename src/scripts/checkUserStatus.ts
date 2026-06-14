import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { admin, firestore } from '../shared/config/firebaseConfig';

async function checkUser(email: string) {
  try {
    console.log(`Checking Firebase Auth for email: ${email}...`);
    const user = await admin.auth().getUserByEmail(email);
    console.log('SUCCESS: User found in Firebase Auth:');
    console.log('- UID:', user.uid);
    console.log('- Email:', user.email);
    console.log('- Display Name:', user.displayName);
    console.log('- Disabled:', user.disabled);

    // Query Firestore collection 'users'
    console.log('\nChecking Firestore collection "users" for id == UID...');
    const db = firestore;
    const querySnap = await db.collection('users').where('id', '==', user.uid).get();
    if (querySnap.empty) {
      console.log('RESULT: No document found in Firestore matching this UID.');
    } else {
      console.log('SUCCESS: Found Firestore user document:');
      const doc = querySnap.docs[0];
      const data = doc.data();
      console.log('- Doc ID:', doc.id);
      console.log('- Deletion Status:', data.deletionStatus || 'active');
      console.log('- Deletion Requested At:', data.deletionRequestedAt ? (data.deletionRequestedAt.toDate ? data.deletionRequestedAt.toDate() : data.deletionRequestedAt) : 'N/A');
    }
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      console.log('RESULT: User does NOT exist in Firebase Auth.');
      process.exit(0);
    } else {
      console.error('ERROR fetching user:', error.message);
      process.exit(1);
    }
  }
  process.exit(0);
}

const email = process.argv[2];
if (!email) {
  console.error('ERROR: Email argument is required.');
  console.log('Usage: npx ts-node src/scripts/checkUserStatus.ts <email>');
  process.exit(1);
}
checkUser(email);
