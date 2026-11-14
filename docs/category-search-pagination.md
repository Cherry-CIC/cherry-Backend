# Category search pagination

## Change

The product listing API already accepts a category ID and a search phrase. This change adds the composite index required by category filtering with newest-first pagination and corrects two shared product-pagination faults.

When text or availability filtering fills a page part-way through the final database batch, additional matches in that batch now retain a continuation cursor. Previously `hasMore` could be false and those matches became unreachable.

Product dates remain normal JavaScript dates in responses. Pagination separately retains the original Firestore timestamp seconds and nanoseconds. Converting the cursor position to milliseconds could skip or repeat nearby records. The existing document-ID tie-breaker remains in place. Existing ISO-date cursors are still accepted. New cursors add precise timestamp fields and keep the existing query signature. Incomplete or invalid precision is rejected before a database read.

The shared fix affects marketplace and owner product pages. The separate likes pagination implementation is unchanged. Authentication, payments, shipping, category documents and product eligibility rules are unchanged.

## Validation

`npm run build` passes. All 403 tests in the configured 45 Jest suites pass with `STRIPE_SECRET_KEY=sk_test_unit_tests_only SENDCLOUD_MODE=mock npm test -- --runInBand`. These are local test settings, not production credentials. The repository's Jest configuration already excludes `exportRoutes.test.ts` and `productRoutes.test.ts`.

The new regression suite exercises repository filters and cursor positions against timestamp-ordered records. It covers final-batch overflow, timestamp precision on both sides of a millisecond, empty scanned batches, equal timestamps, category and phrase matching, marketplace eligibility, legacy cursors and malformed cursors. This is an in-memory Firestore test double, not a live Firestore integration test.

## Rollout

1. Review the exact application diff and index addition.
2. In the development database, add only the composite products index with `categoryId ASC`, `createdAt DESC`, `__name__ DESC`, collection query scope. Preserve existing indexes, including any absent from this repository. Do not accept index deletion prompts as part of this change.
3. Wait for READY, then deploy this backend revision through the normal release process.
4. Verify category-only and category-plus-text requests, empty results, eligibility and all pages of a controlled fixture. Check owner product pages because they share this pagination helper. Check rejection of a cursor used with a different category.
5. Repeat the index-readiness and read-only smoke checks for production before releasing the frontend. Keep the footer Search entry disabled until the deployed flow is verified.

No index or application deployment has been performed by preparing this change. It contains no data migration or database writes. If the application needs rolling back, keep the additive index and deploy the prior application revision. A fresh search resets any outstanding cursor.

## Existing limit

Text matching is a case-insensitive contiguous phrase across name, description, size and quality. It is evaluated after reading Firestore batches. Rare or absent terms may scan the entire relevant catalogue. This fix does not introduce ranking, fuzzy matching or an indexed full-text engine.
