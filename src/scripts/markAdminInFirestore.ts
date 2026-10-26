/**
 * Mark existing admin users in Firestore
 * This script updates Firestore documents to add the isAdmin field
 */

import { admin, firestore } from '../shared/config/firebaseConfig';

async function markAdminInFirestore(): Promise<void> {
  try {
    console.log('Fetching all Firebase Auth admin users...');

    // Get all users with admin claims from Firebase Auth
    const listUsersResult = await admin.auth().listUsers(1000);
    const adminUsers = listUsersResult.users.filter(
      user => user.customClaims && (user.customClaims as any).admin === true
    );

    console.log(`Found ${adminUsers.length} admin user(s) in Firebase Auth\n`);

    // Update Firestore documents
    for (const authUser of adminUsers) {
      const usersSnapshot = await firestore
        .collection('users')
        .where('id', '==', authUser.uid)
        .get();

      if (!usersSnapshot.empty) {
        const userDoc = usersSnapshot.docs[0];
        await userDoc.ref.update({
          isAdmin: true,
          updatedAt: new Date(),
        });
        console.log(`✓ Updated Firestore for ${authUser.email} (${authUser.uid})`);
      } else {
        console.log(`⚠ No Firestore document found for ${authUser.email} (${authUser.uid})`);
      }
    }

    console.log('\nDone!');
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error);
    if (error instanceof Error) {
      console.error('  Message:', error.message);
    }
    process.exit(1);
  }
}

markAdminInFirestore();
