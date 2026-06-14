import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { firestore } from '../shared/config/firebaseConfig';

async function run() {
    const args = process.argv.slice(2);
    const userId = args[0];
    const productId = args[1] || 'test-product-id';
    const status = args[2] === 'completed' ? 'completed' : 'pending';

    if (!userId) {
        console.error('Usage: npx ts-node src/scripts/createTestOrder.ts <userId> [productId] [pending|completed]');
        process.exit(1);
    }

    console.log(`Creating test order for user: ${userId}, product: ${productId}, status: ${status}...`);

    const orderData = {
        userId,
        productId,
        amount: 2599,
        paymentStatus: status === 'pending' ? 'pending' : 'succeeded',
        shipmentStatus: status === 'pending' ? 'not_created' : 'delivered',
        status,
        createdAt: new Date(),
        deliveryType: 'pickup_point',
        shippingOptionId: '12345',
        shipping: {
            name: 'Test Buyer',
            telephone: '+447700900000',
            address: {
                line1: '10 High Street',
                house_number: '10',
                city: 'London',
                postal_code: 'SW1A 1AA',
                country: 'GB'
            }
        }
    };

    const docRef = await firestore.collection('orders').add(orderData);
    console.log(`Successfully created test order with ID: ${docRef.id}`);
}

run().catch(err => {
    console.error('Failed to create test order:', err);
    process.exit(1);
});
