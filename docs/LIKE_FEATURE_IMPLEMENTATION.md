# Like/Unlike Feature - User Product Preferences

## Overview
This feature allows authenticated users to like and unlike products, with their preferences tracked and reflected in product data and custom views. The system stores user-product relationships and provides endpoints to manage likes and retrieve liked products.

## Files Added/Modified

### New Files:
1. **`src/modules/products/tests/likeFeature.test.ts`** - Comprehensive test suite

### Modified Files:
1. **`src/modules/products/model/Product.ts`** - Added optional `likedBy` array field
2. **`src/modules/products/repositories/ProductRepository.ts`** - Added like management methods
3. **`src/modules/products/services/ProductService.ts`** - Added service layer methods
4. **`src/modules/products/controllers/productController.ts`** - Added/updated like handlers
5. **`src/modules/products/routes/productRoutes.ts`** - Added like endpoints with authentication

---

## API Endpoints

### Like a Product
```
POST /api/products/:id/like
```

**Authentication:** Required (Bearer token)

**Response:**
```json
{
  "success": true,
  "message": "Product liked successfully",
  "data": {
    "likeCount": 42,
    "isLikedByUser": true
  },
  "timestamp": "2024-11-15T10:30:00.000Z"
}
```

**Error Responses:**
- `401` - Unauthorized (no auth token)
- `404` - Product not found
- `500` - Server error

---

### Unlike a Product
```
DELETE /api/products/:id/like
```

**Authentication:** Required (Bearer token)

**Response:**
```json
{
  "success": true,
  "message": "Product unliked successfully",
  "data": {
    "likeCount": 41,
    "isLikedByUser": false
  },
  "timestamp": "2024-11-15T10:31:00.000Z"
}
```

**Error Responses:**
- `401` - Unauthorized (no auth token)
- `404` - Product not found
- `500` - Server error

---

### Get User's Liked Products
```
GET /api/products/user/liked
```

**Authentication:** Required (Bearer token)

**Response:**
```json
{
  "success": true,
  "message": "Liked products fetched successfully",
  "data": [
    {
      "id": "product-123",
      "name": "Winter Coat",
      "likes": 42,
      "likeCount": 42,
      "isLikedByUser": true
    }
  ],
  "timestamp": "2024-11-15T10:32:00.000Z"
}
```

**Error Responses:**
- `401` - Unauthorized (no auth token)
- `500` - Server error

---

### Get Product with Like Status
All product GET endpoints now include like information when user is authenticated:

```
GET /api/products/:id
GET /api/products
GET /api/products/with-details
GET /api/products/:id/details
```

**Response includes:**
```json
{
  "id": "product-123",
  "name": "Product Name",
  "likes": 42,
  "likeCount": 42,
  "isLikedByUser": true,
  ...
}
```

---

## Implementation Details

### Data Model
**File**: `src/modules/products/model/Product.ts`
- Added optional `likedBy?: string[]` field marked as PRIVATE
- Field should never be exposed in API responses

### Repository Layer
**File**: `src/modules/products/repositories/ProductRepository.ts`
- `addLike(id, userId)` - Uses transaction to check if user already liked before incrementing
- `removeLike(id, userId)` - Uses transaction to check if user in array before decrementing, prevents negative likes
- `getProductsLikedByUser(userId, limit, startAfter)` - Query with pagination support (default limit: 20)

### Service Layer
**File**: `src/modules/products/services/ProductService.ts`
- `likeProduct(productId, userId)` - Handle like operation
- `unlikeProduct(productId, userId)` - Handle unlike operation
- `getProductsLikedByUser(userId, limit, startAfter)` - Retrieve user's liked products with pagination

### Controller Layer
**File**: `src/modules/products/controllers/productController.ts`
- **Helper Function**: `formatProductResponse()` - Centralized function to strip private fields and add computed fields
- `likeProduct()` - POST handler for liking
- `unlikeProduct()` - DELETE handler for unliking
- `getLikedProducts()` - GET handler with pagination support (limit, startAfter)
- Enhanced all GET handlers to use `formatProductResponse()` helper
- **CRITICAL:** All handlers strip private `likedBy` field via helper function using destructuring

### Routes
**File**: `src/modules/products/routes/productRoutes.ts`
- POST /:id/like - Like endpoint
- DELETE /:id/like - Unlike endpoint
- GET /user/liked - User's liked products with pagination
- **Swagger Documentation**: Updated Product schema to remove `likedBy`, add `likeCount` and `isLikedByUser` fields

---

## Security Features

1. **Authentication Required**
   - All like/unlike endpoints require valid Firebase token
   - Unauthenticated requests return 401

2. **User Isolation**
   - Each user manages only their own likes
   - User ID extracted from authenticated token

3. **Transaction-Based Idempotency**
   - Uses Firestore transactions to prevent race conditions
   - addLike: Only increments if user not already in likedBy array
   - removeLike: Only decrements if user is in likedBy array
   - Prevents duplicate likes from double-incrementing counter

4. **Privacy Protection**
   - likedBy field is NEVER exposed in API responses
   - All responses strip private likedBy data before sending
   - Only likeCount and isLikedByUser are included

5. **Data Integrity**
   - Like counts cannot go negative (Math.max(0, ...))
   - Atomic operations prevent data corruption
   - Input validation on product IDs

---

## Testing

### Manual Testing

**Like a Product:**
```bash
curl -X POST "http://localhost:4000/api/products/PRODUCT_ID/like" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Unlike a Product:**
```bash
curl -X DELETE "http://localhost:4000/api/products/PRODUCT_ID/like" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Get Liked Products:**
```bash
curl -X GET "http://localhost:4000/api/products/user/liked" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Get Product with Like Status:**
```bash
curl -X GET "http://localhost:4000/api/products/PRODUCT_ID" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Test Scenarios

The implementation has been tested for:
- Authenticated user can like a product
- Authenticated user can unlike a product
- Liking already-liked product is idempotent
- Unliking non-liked product is idempotent
- Duplicate likes do NOT double-increment counter (transaction-based check)
- Unlike operations never make like count go negative
- Unauthenticated requests return 401
- Invalid product ID returns 404
- GET endpoints include isLikedByUser and likeCount
- **likedBy field is NOT present in any API response** (privacy protection)
- Multiple users can like the same product
- Like count increments/decrements correctly
- Backwards compatibility with products without likedBy field
- Pagination works on GET /user/liked with limit and startAfter parameters

---

## Database Schema

### Before
```typescript
Product {
  id: string
  name: string
  likes: number
}
```

### After
```typescript
Product {
  id: string
  name: string
  likes: number
  likedBy?: string[]
}
```

### Firestore Index
For optimal performance with large datasets, create a Firestore index:
```
Collection: products
Field: likedBy (Array)
Query scope: Collection
```

---

## Backwards Compatibility

All existing endpoints work unchanged. Existing products without the `likedBy` field are handled gracefully. The old `adjustLikes()` method remains available for backwards compatibility. Response structure is preserved with new fields added and none removed.

No database migration is needed. The optional `likedBy` field is:
- Automatically created when a user first likes a product
- Gracefully handled when missing (defaults to empty array in logic)
- Non-breaking for existing products

---

## Error Handling

All endpoints follow consistent error patterns:

```json
{
  "success": false,
  "message": "User-friendly error message",
  "error": "Technical error details",
  "timestamp": "2024-11-15T10:30:00.000Z"
}
```

Common errors:
- `401 Unauthorized` - Missing or invalid auth token
- `404 Not Found` - Product doesn't exist
- `500 Internal Server Error` - Database or server issue

---

## Frontend Integration

1. All like/unlike requests require `Authorization: Bearer <token>` header with Firebase ID token
2. Operations are safe to retry - like/unlike actions are idempotent with transaction-based checks
3. Response includes `likeCount` (integer) and `isLikedByUser` (boolean)
4. **likedBy array is NEVER exposed** - only use likeCount and isLikedByUser
5. GET /user/liked supports pagination with `limit` (default 20) and `startAfter` query parameters
6. UI can be updated optimistically before server confirmation, with rollback on failure
7. Firebase listeners can be added later for real-time updates without architectural changes

---

## Acceptance Criteria

| Requirement | Status |
|------------|--------|
| Logged-in user can like item | Complete |
| User ID added to likedBy array | Complete |
| Like count increments | Complete |
| Response includes count and isLikedByUser | Complete |
| User can unlike item | Complete |
| User ID removed from likedBy | Complete |
| Like count decrements | Complete |
| Item fetch includes isLikedByUser | Complete |
| Item fetch includes likeCount | Complete |
| User can fetch liked items | Complete |
| Unauthenticated attempts return 401 | Complete |
| Operations are idempotent | Complete |
| Operations are atomic | Complete |
| Backwards compatible | Complete |
| **Duplicate likes don't double-increment** | Complete |
| **likedBy never exposed in responses** | Complete |
| **Pagination on GET /user/liked** | Complete |
| **Like count never goes negative** | Complete |  
