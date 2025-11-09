# CSV Export Feature - Admin Orders Export

## Overview
This feature allows administrators to export order and donation data as CSV files for grant reporting and compliance purposes. The exported CSV includes order details, donation amounts, and status information within a specified date range.

## Files Added/Modified

### New Files:
1. **`src/shared/middleware/adminMiddleware.ts`** - Admin authorization middleware
2. **`src/modules/order/controllers/exportController.ts`** - CSV export controller
3. **`src/modules/order/routes/adminRoutes.ts`** - Admin routes definition
4. **`src/modules/order/tests/exportRoutes.test.ts`** - Comprehensive test suite

### Modified Files:
1. **`src/modules/order/model/Order.ts`** - Added optional `email` and `status` fields
2. **`src/modules/order/repositories/OrderRepository.ts`** - Added `getOrdersByDateRange()` method
3. **`src/app.ts`** - Registered admin routes
4. **`package.json`** - Added `fast-csv` dependency

## API Endpoint

### Export Orders CSV
```
GET /api/admin/export/orders?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
```

**Authentication:** Required (Bearer token with admin privileges)

**Query Parameters:**
- `start_date` (required): Start date in YYYY-MM-DD format (inclusive)
- `end_date` (required): End date in YYYY-MM-DD format (inclusive)

**Response:**
```json
{
  "success": true,
  "message": "CSV export generated successfully",
  "data": {
    "url": "https://storage.googleapis.com/...",
    "filename": "exports/orders_2024-01-01_to_2024-12-31_2024-11-07T12-30-45-123Z.csv",
    "recordCount": 150,
    "dateRange": {
      "start": "2024-01-01",
      "end": "2024-12-31"
    },
    "expiresIn": "1 hour"
  },
  "timestamp": "2024-11-07T12:30:45.123Z"
}
```

## CSV Format

The exported CSV contains the following columns:

| Column | Description | Example |
|--------|-------------|---------|
| Order ID | Unique order identifier | `abc123def456` |
| User ID | Firebase user ID | `user_xyz789` |
| Email | User's email address | `user@example.com` |
| Items Donated | Product name or items | `Winter Coat` |
| Donation Amount (£) | Amount in pounds | `50.00` |
| Date of Order/Donation | ISO timestamp | `2024-06-15T10:30:00.000Z` |
| Status | Order status | `completed`, `pending`, or `failed` |

## Admin Setup

### Setting Admin Privileges

To grant admin privileges to a user, you need to set custom claims using Firebase Admin SDK:

```typescript
import { admin } from './src/shared/config/firebaseConfig';

// Grant admin access to a user
async function setAdminClaim(uid: string) {
  await admin.auth().setCustomUserClaims(uid, { admin: true });
  console.log(`Admin privileges granted to user: ${uid}`);
}

// Usage
setAdminClaim('user-firebase-uid');
```

**Note:** After setting custom claims, the user needs to refresh their authentication token for the changes to take effect.

### Verifying Admin Status

Users can verify their admin status by decoding their Firebase ID token. The token will contain:
```json
{
  "uid": "user-firebase-uid",
  "email": "admin@example.com",
  "admin": true
}
```

## Security Features

1. **Two-Level Authentication:**
   - First level: `authMiddleware` validates Firebase ID token
   - Second level: `adminMiddleware` checks for admin custom claim

2. **Secure File Storage:**
   - CSV files are stored in Firebase Storage (private bucket)
   - Signed URLs with 1-hour expiration
   - Files stored in `exports/` directory

3. **Input Validation:**
   - Date format validation (YYYY-MM-DD)
   - Date range validation (start must be <= end)
   - Required parameter checks

## Environment Configuration

Ensure the following environment variable is set:

```env
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
```

## Testing

Run the comprehensive test suite:

```bash
npm test -- exportRoutes.test.ts
```

The test suite covers:
- Authentication and authorization
- Input validation
- CSV generation with various data scenarios
- Error handling
- Empty result sets

## Usage Examples

### Example 1: Export Orders for Q1 2024
```bash
curl -X GET "http://localhost:4000/api/admin/export/orders?start_date=2024-01-01&end_date=2024-03-31" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Example 2: Export Orders for Specific Month
```bash
curl -X GET "http://localhost:4000/api/admin/export/orders?start_date=2024-06-01&end_date=2024-06-30" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Example 3: Using Postman
1. Method: GET
2. URL: `http://localhost:4000/api/admin/export/orders`
3. Params:
   - `start_date`: `2024-01-01`
   - `end_date`: `2024-12-31`
4. Headers:
   - `Authorization`: `Bearer YOUR_ADMIN_TOKEN`

## Error Handling

### Common Errors:

**401 Unauthorized:**
```json
{
  "success": false,
  "message": "Authorization header is required",
  "error": "Missing or invalid Bearer token"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Admin access required",
  "error": "User does not have admin privileges"
}
```

**400 Bad Request:**
```json
{
  "success": false,
  "message": "Invalid date format",
  "error": "Dates must be in YYYY-MM-DD format"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Export failed",
  "error": "Detailed error message"
}
```

## Acceptance Criteria Verification

✅ **Admin Authentication**: Only users with admin custom claims can access the endpoint
✅ **Date Range Filtering**: Orders are filtered by the specified date range (inclusive)
✅ **CSV Headers**: CSV always includes headers, even when no data exists
✅ **Status Tracking**: Failed/pending orders are marked with appropriate status
✅ **Secure Download**: Signed URLs expire after 1 hour
✅ **Empty Results**: Empty date ranges return CSV with headers only

## Performance Considerations (For Future)

- **Small Datasets (< 1000 records)**: Response time < 5 seconds
- **Medium Datasets (1000-10000 records)**: Response time 5-30 seconds
- **Large Datasets (> 10000 records)**: Consider implementing pagination or async job processing

For very large exports, can consider:
1. Implementing batch processing
2. Using Cloud Functions for background processing
3. Emailing download links when ready

## Maintenance

### Storage Cleanup

Firebase Storage lifecycle rules can be configured to auto-delete old export files:

1. Go to Firebase Console → Storage
2. Create lifecycle rule:
   - Condition: Age > 7 days
   - Action: Delete
   - Prefix: `exports/`

### Monitoring

Monitor these metrics:
- Export request frequency
- Average export size
- Failed export attempts
- Storage usage in `exports/` directory

## Support

For issues or questions:
1. Check the logs for detailed error messages
2. Verify Firebase Storage configuration
3. Confirm admin custom claims are properly set
4. Review the test suite for usage examples

## Future Enhancements

Potential improvements:
1. Add filters for status, user ID, or product
2. Support multiple export formats (Excel, JSON)
3. Schedule automated exports
4. Email notifications with download links
5. Audit logging for export requests
