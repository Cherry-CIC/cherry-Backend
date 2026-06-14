import request from 'supertest';
import app from '../../../app';
import { admin, firestore } from '../../../shared/config/firebaseConfig';
import { ProductRepository } from '../../products/repositories/ProductRepository';

// Setup mock state variables
let mockUsersResponse: any[] = [];
let mockOrdersResponse: any[] = [];
let mockProductsResponse: any[] = [];

// Mock Firebase Config and Admin with query-inspecting chain objects
jest.mock('../../../shared/config/firebaseConfig', () => {
    const mockUpdate = jest.fn();
    const mockAdd = jest.fn();
    const mockDelete = jest.fn();

    const mockDoc = jest.fn().mockImplementation((docId: string) => ({
        get: () => {
            let foundDoc = null;
            if (docId) {
                foundDoc = mockUsersResponse.find(u => u.id === docId || u.data?.().id === docId);
            }
            return Promise.resolve({
                exists: !!foundDoc,
                data: () => foundDoc ? foundDoc.data() : null
            });
        },
        update: mockUpdate,
        delete: mockDelete
    }));

    const mockCollection = jest.fn().mockImplementation((collectionName: string) => {
        const filters: any[] = [];
        const queryChain: any = {
            doc: mockDoc,
            where: jest.fn().mockImplementation((field, op, val) => {
                filters.push({ field, op, val });
                return queryChain;
            }),
            limit: jest.fn().mockImplementation(() => queryChain),
            add: mockAdd,
            get: jest.fn().mockImplementation(() => {
                let responseDocs: any[] = [];
                if (collectionName === 'users') {
                    // For process-deletions user checking
                    const idFilter = filters.find(f => f.field === 'id');
                    if (idFilter) {
                        responseDocs = mockUsersResponse.filter(u => u.id === idFilter.val || u.data?.().id === idFilter.val);
                    } else {
                        responseDocs = mockUsersResponse;
                    }
                }
                if (collectionName === 'products') {
                    const statusFilter = filters.find(f => f.field === 'visibilityStatus');
                    if (statusFilter && statusFilter.op === '!=' && statusFilter.val === 'inactive') {
                        responseDocs = mockProductsResponse.filter(p => p.data().visibilityStatus !== 'inactive');
                    } else if (statusFilter && statusFilter.op === '==' && statusFilter.val === 'active') {
                        responseDocs = mockProductsResponse.filter(p => p.data().visibilityStatus === 'active');
                    } else {
                        responseDocs = mockProductsResponse;
                    }
                }
                if (collectionName === 'orders') {
                    const userIdFilter = filters.find(f => f.field === 'userId');
                    if (userIdFilter && userIdFilter.val === 'blocked-pending-uid') {
                        responseDocs = [{
                            id: 'o-blocked',
                            data: () => ({
                                id: 'o-blocked',
                                userId: 'blocked-pending-uid',
                                paymentStatus: 'pending',
                                status: 'pending',
                                shipmentStatus: 'not_created'
                            })
                        }];
                    } else if (userIdFilter && userIdFilter.val === 'clear-pending-uid') {
                        responseDocs = [];
                    } else {
                        responseDocs = mockOrdersResponse;
                    }
                }

                return Promise.resolve({
                    empty: responseDocs.length === 0,
                    size: responseDocs.length,
                    docs: responseDocs
                });
            })
        };
        return queryChain;
    });

    const mockBatchCommit = jest.fn();
    const mockBatchUpdate = jest.fn();
    const mockBatch = jest.fn().mockReturnValue({
        update: mockBatchUpdate,
        commit: mockBatchCommit
    });

    const mockAdmin = {
        auth: jest.fn().mockReturnValue({
            verifyIdToken: jest.fn(),
            deleteUser: jest.fn()
        })
    };

    const mockFirestore = {
        collection: mockCollection,
        batch: mockBatch
    };

    return {
        admin: mockAdmin,
        firestore: mockFirestore
    };
});

describe('User Deletion Flow', () => {
    let mockToken: string;
    let mockAdminToken: string;

    const mockUserDoc = {
        id: 'user-doc-id',
        ref: {
            update: jest.fn().mockResolvedValue(true)
        },
        data: () => ({
            id: 'test-user-uid',
            email: 'test@example.com',
            displayName: 'Test User',
            deletionStatus: 'active'
        })
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockToken = 'valid-user-token';
        mockAdminToken = 'valid-admin-token';

        // Reset collection mock responses
        mockUsersResponse = [mockUserDoc];
        mockOrdersResponse = [];
        mockProductsResponse = [];

        // Mock auth middleware verification
        (admin.auth().verifyIdToken as jest.Mock).mockImplementation((token: string) => {
            if (token === mockToken) {
                return Promise.resolve({ uid: 'test-user-uid', admin: false });
            }
            if (token === mockAdminToken) {
                return Promise.resolve({ uid: 'admin-uid', admin: true });
            }
            throw new Error('Invalid token');
        });
    });

    describe('DELETE /api/users/me (Immediate Deletion)', () => {
        it('should return 204 and fully delete user if no blockers exist', async () => {
            (admin.auth().deleteUser as jest.Mock).mockResolvedValue(undefined);

            const res = await request(app)
                .delete('/api/users/me')
                .set('Authorization', `Bearer ${mockToken}`);

            expect(res.status).toBe(204);
            expect(admin.auth().deleteUser).toHaveBeenCalledWith('test-user-uid');
            expect(mockUserDoc.ref.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    deletionStatus: 'deleted',
                    displayName: 'Deleted User'
                })
            );
        });

        it('should return 409 Conflict if active orders exist', async () => {
            // Mock an active order in buyer orders
            mockOrdersResponse = [{
                id: 'active-order-id',
                data: () => ({
                    id: 'active-order-id',
                    userId: 'test-user-uid',
                    paymentStatus: 'pending',
                    status: 'pending',
                    shipmentStatus: 'not_created'
                })
            }];

            const res = await request(app)
                .delete('/api/users/me')
                .set('Authorization', `Bearer ${mockToken}`);

            expect(res.status).toBe(409);
            expect(res.body.status).toBe('blocked');
            expect(res.body.reason).toBe('outstanding_tasks');
            expect(res.body.blockingItems).toContain('active_order');
        });
    });

    describe('POST /api/users/me/deletion-request (Queue Deletion)', () => {
        it('should return 202 and set user status to pending_deletion', async () => {
            const res = await request(app)
                .post('/api/users/me/deletion-request')
                .set('Authorization', `Bearer ${mockToken}`);

            expect(res.status).toBe(202);
            expect(res.body.success).toBe(true);
            expect(mockUserDoc.ref.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    deletionStatus: 'pending_deletion'
                })
            );
        });
    });

    describe('POST /api/users/process-deletions (Scheduled cron trigger)', () => {
        it('should process pending deletion users, deleting clear ones and keeping blocked ones', async () => {
            const mockPendingUserBlocked = {
                id: 'blocked-pending-uid',
                ref: { update: jest.fn() },
                data: () => ({ id: 'blocked-pending-uid', deletionStatus: 'pending_deletion' })
            };
            const mockPendingUserClear = {
                id: 'clear-pending-uid',
                ref: { update: jest.fn() },
                data: () => ({ id: 'clear-pending-uid', deletionStatus: 'pending_deletion' })
            };

            // Set users collection response
            mockUsersResponse = [mockPendingUserBlocked, mockPendingUserClear];

            const res = await request(app)
                .post('/api/users/process-deletions')
                .set('Authorization', `Bearer ${mockAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.processed).toBe(2);
            expect(res.body.data.deleted).toBe(1);

            expect(admin.auth().deleteUser).toHaveBeenCalledWith('clear-pending-uid');
            expect(admin.auth().deleteUser).not.toHaveBeenCalledWith('blocked-pending-uid');
        });
    });

    describe('ProductRepository (Visibility status database-level queries)', () => {
        it('should retrieve only active products from general endpoints and check limits', async () => {
            const productsData = [
                { id: 'p1', name: 'Product 1', visibilityStatus: 'active' },
                { id: 'p2', name: 'Product 2', visibilityStatus: 'inactive' }
            ];

            mockProductsResponse = productsData.map(p => ({
                id: p.id,
                data: () => p
            }));

            const repo = new ProductRepository();
            const allProducts = await repo.getAll();
            
            expect(allProducts.length).toBe(1);
        });
    });
});
