// Run as a scheduled, authenticated Cloud Run Job after explicit deployment.
// Do not start a background timer inside a request-driven Cloud Run instance.
import 'dotenv/config';
import { CollectionPushDispatcher } from '../modules/notifications/services/CollectionPushDispatcher';

new CollectionPushDispatcher().runBatch().then(result => {
  console.log(JSON.stringify(result));
}).catch(() => {
  console.error('Collection notification worker failed');
  process.exitCode = 1;
});
