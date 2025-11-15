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
- Added optional `likedBy?: string[]` field to store user IDs

### Repository Layer
**File**: `src/modules/products/repositories/ProductRepository.ts`
- `addLike(id, userId)` - Add user to likedBy array and increment count (atomic)
- `removeLike(id, userId)` - Remove user from likedBy array and decrement count (atomic)
- `getProductsLikedByUser(userId)` - Query products where user is in likedBy array

### Service Layer
**File**: `src/modules/products/services/ProductService.ts`
- `likeProduct(productId, userId)` - Handle like operation
- `unlikeProduct(productId, userId)` - Handle unlike operation
- `getProductsLikedByUser(userId)` - Retrieve user's liked products

### Controller Layer
**File**: `src/modules/products/controllers/productController.ts`
- `likeProduct()` - POST handler for liking
- `unlikeProduct()` - DELETE handler for unliking
- `getLikedProducts()` - GET handler for user's liked products
- Enhanced all GET handlers to include `isLikedByUser` and `likeCount`

### Routes
**File**: `src/modules/products/routes/productRoutes.ts`
- POST /:id/like - Like endpoint
- DELETE /:id/like - Unlike endpoint
- GET /user/liked - User's liked products
- Swagger documentation updated for all endpoints

---

## Security Features

1. **Authentication Required**
   - All like/unlike endpoints require valid Firebase token
   - Unauthenticated requests return 401

2. **User Isolation**
   - Each user manages only their own likes
   - User ID extracted from authenticated token

3. **Atomic Operations**
   - Uses Firestore arrayUnion and arrayRemove
   - Prevents race conditions with concurrent operations

4. **Input Validation**
   - Product ID validation
   - Returns 404 for non-existent products

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
- Unauthenticated requests return 401
- Invalid product ID returns 404
- GET endpoints include isLikedByUser and likeCount
- Multiple users can like the same product
- Like count increments/decrements correctly
- Backwards compatibility with products without likedBy field

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
2. Operations are safe to retry - like/unlike actions are idempotent
3. Response includes `likeCount` (integer) and `isLikedByUser` (boolean)
4. UI can be updated optimistically before server confirmation, with rollback on failure
5. Firebase listeners can be added later for real-time updates without architectural changes

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
