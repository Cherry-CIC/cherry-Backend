import { firestore } from '../shared/config/firebaseConfig';
import { FieldValue } from 'firebase-admin/firestore';

async function migrate() {
    console.log('Starting migration for legacy products...');
    const snapshot = await firestore.collection('products').get();
    const docs = snapshot.docs;
    
    const toMigrate = docs.filter(doc => {
        const data = doc.data();
        return data.visibilityStatus === undefined;
    });

    console.log(`Found ${toMigrate.length} products to migrate out of ${docs.length} total.`);

    const batchLimit = 500;
    for (let i = 0; i < toMigrate.length; i += batchLimit) {
        const batch = firestore.batch();
        const chunk = toMigrate.slice(i, i + batchLimit);
        chunk.forEach(doc => {
            batch.update(doc.ref, {
                visibilityStatus: 'active',
                updatedAt: FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
        console.log(`Migrated batch ${i / batchLimit + 1} (${chunk.length} products).`);
    }

    console.log('Migration completed successfully.');
}

if (require.main === module) {
    migrate().catch(err => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
}
export { migrate };
