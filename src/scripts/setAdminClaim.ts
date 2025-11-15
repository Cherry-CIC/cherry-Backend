/**
 * Admin User Management Script
 * 
 * This script helps manage admin privileges for users.
 * Run this script with Node.js after building the project.
 * 
 * Usage:
 *   npm run build
 *   node dist/scripts/setAdminClaim.js <firebase-uid> [true|false]
 * 
 * Examples:
 *   node dist/scripts/setAdminClaim.js abc123xyz true   # Grant admin
 *   node dist/scripts/setAdminClaim.js abc123xyz false  # Revoke admin
 */

import { admin } from '../shared/config/firebaseConfig';

async function setAdminClaim(uid: string, isAdmin: boolean = true): Promise<void> {
  try {
    console.log(`Setting admin claim for user ${uid} to ${isAdmin}...`);
    
    // Set custom claims
    await admin.auth().setCustomUserClaims(uid, { admin: isAdmin });
    
    console.log(`✓ Successfully set admin claim for user ${uid}`);
    console.log(`  Admin status: ${isAdmin}`);
    console.log('\nNote: The user must refresh their authentication token for changes to take effect.');
    
    // Verify the claim was set
    const user = await admin.auth().getUser(uid);
    console.log('\nCurrent custom claims:', user.customClaims);
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Error setting admin claim:', error);
    if (error instanceof Error) {
      console.error('  Message:', error.message);
    }
    process.exit(1);
  }
}

async function listAdminUsers(): Promise<void> {
  try {
    console.log('Fetching users with admin privileges...\n');
    
    const listUsersResult = await admin.auth().listUsers(1000);
    const adminUsers = listUsersResult.users.filter(
      user => user.customClaims && (user.customClaims as any).admin === true
    );
    
    if (adminUsers.length === 0) {
      console.log('No admin users found.');
    } else {
      console.log(`Found ${adminUsers.length} admin user(s):\n`);
      adminUsers.forEach((user, index) => {
        console.log(`${index + 1}. UID: ${user.uid}`);
        console.log(`   Email: ${user.email || 'N/A'}`);
        console.log(`   Display Name: ${user.displayName || 'N/A'}`);
        console.log('');
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Error listing admin users:', error);
    if (error instanceof Error) {
      console.error('  Message:', error.message);
    }
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === 'list') {
  // List all admin users
  listAdminUsers();
} else if (args.length >= 1) {
  const uid = args[0];
  const isAdmin = args[1] !== 'false'; // Default to true unless explicitly set to false
  
  if (!uid || uid.length < 5) {
    console.error('Error: Please provide a valid Firebase UID');
    console.log('\nUsage:');
    console.log('  Set admin:    npm run admin:set <uid> [true|false]');
    console.log('  List admins:  npm run admin:list');
    process.exit(1);
  }
  
  setAdminClaim(uid, isAdmin);
} else {
  console.log('Usage:');
  console.log('  Set admin:    npm run admin:set <uid> [true|false]');
  console.log('  List admins:  npm run admin:list');
  process.exit(1);
}
