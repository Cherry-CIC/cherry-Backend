import { Request, Response } from 'express';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { OrderRepository } from '../repositories/OrderRepository';
import { admin } from '../../../shared/config/firebaseConfig';
import { format } from '@fast-csv/format';

/**
 * Exports orders as a CSV file within a specified date range.
 * The CSV is uploaded to Firebase Storage and a signed URL is returned.
 *
 * Query parameters:
 * - start_date: Start date in YYYY-MM-DD format (inclusive)
 * - end_date: End date in YYYY-MM-DD format (inclusive)
 *
 * Returns a signed URL valid for 1 hour to download the CSV file.
 */
export const exportOrdersCsv = async (req: Request, res: Response): Promise<void> => {
  try {
    // Extract and validate query parameters
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      ResponseHandler.badRequest(
        res,
        'Missing required parameters',
        'Both start_date and end_date are required in YYYY-MM-DD format'
      );
      return;
    }

    // Validate date format and parse dates
    const startDateStr = start_date as string;
    const endDateStr = end_date as string;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDateStr) || !dateRegex.test(endDateStr)) {
      ResponseHandler.badRequest(
        res,
        'Invalid date format',
        'Dates must be in YYYY-MM-DD format'
      );
      return;
    }

    // Parse dates with time boundaries (start at 00:00:00, end at 23:59:59)
    const startDate = new Date(startDateStr + 'T00:00:00.000Z');
    const endDate = new Date(endDateStr + 'T23:59:59.999Z');

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      ResponseHandler.badRequest(res, 'Invalid dates', 'Unable to parse provided dates');
      return;
    }

    if (startDate > endDate) {
      ResponseHandler.badRequest(
        res,
        'Invalid date range',
        'start_date must be before or equal to end_date'
      );
      return;
    }

    // Retrieve orders from repository
    const orderRepo = new OrderRepository();
    const orders = await orderRepo.getOrdersByDateRange(startDate, endDate);

    // Check Firebase Storage configuration
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
    if (!bucketName) {
      console.error('FIREBASE_STORAGE_BUCKET environment variable is not set');
      ResponseHandler.internalServerError(
        res,
        'Storage not configured',
        'Firebase Storage bucket is not configured'
      );
      return;
    }

    // Get Firebase Storage bucket
    const bucket = admin.storage().bucket(bucketName);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split(':').join('-').split('.').join('-');
    const filename = `exports/orders_${startDateStr}_to_${endDateStr}_${timestamp}.csv`;
    const file = bucket.file(filename);

    // Create CSV stream
    const csvStream = format({
      headers: [
        'Order ID',
        'User ID',
        'Email',
        'Items Donated',
        'Donation Amount (£)',
        'Date of Order/Donation',
        'Status',
      ],
      writeBOM: true, // Add BOM for proper Excel encoding
    });

    // Create write stream to Firebase Storage
    const writeStream = file.createWriteStream({
      metadata: {
        contentType: 'text/csv',
        metadata: {
          exportedBy: (req as any).user?.uid || 'unknown',
          exportedAt: new Date().toISOString(),
          dateRange: `${startDateStr} to ${endDateStr}`,
        },
      },
      resumable: false,
    });

    // Handle stream errors
    let streamError: Error | null = null;
    writeStream.on('error', (error) => {
      console.error('Write stream error:', error);
      streamError = error;
    });

    csvStream.on('error', (error: Error | null) => {
      console.error('CSV stream error:', error);
      streamError = error;
    });

    // Pipe CSV stream to Firebase Storage
    csvStream.pipe(writeStream);

    // Write data rows
    if (orders.length === 0) {
      // No orders found - file will have headers only
      console.log(`No orders found for date range ${startDateStr} to ${endDateStr}`);
    } else {
      for (const order of orders) {
        // Convert amount from pence to pounds
        const amountInPounds = (order.amount / 100).toFixed(2);

        // Format date
        const orderDate = order.createdAt
          ? new Date(order.createdAt).toISOString()
          : 'N/A';

        // Get items donated (product name or 'N/A')
        const items = order.productName || 'N/A';

        // Write row
        csvStream.write([
          order.id || 'N/A',
          order.userId || 'N/A',
          order.email || 'N/A',
          items,
          amountInPounds,
          orderDate,
          order.status || 'completed',
        ]);
      }
    }

    // End the CSV stream
    csvStream.end();

    // Wait for the upload to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => {
        if (streamError) {
          reject(streamError);
        } else {
          resolve();
        }
      });

      writeStream.on('error', (error) => {
        reject(error);
      });
    });

    // Generate signed URL (valid for 1 hour)
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour from now
    });

    console.log(`CSV export successful: ${filename} (${orders.length} orders)`);

    // Return success response with download URL
    ResponseHandler.success(
      res,
      {
        url: signedUrl,
        filename: filename,
        recordCount: orders.length,
        dateRange: {
          start: startDateStr,
          end: endDateStr,
        },
        expiresIn: '1 hour',
      },
      'CSV export generated successfully'
    );
  } catch (error) {
    console.error('Error exporting orders to CSV:', error);
    ResponseHandler.internalServerError(
      res,
      'Export failed',
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
};
