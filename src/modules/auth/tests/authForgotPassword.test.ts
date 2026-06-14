import request from 'supertest';
import app from '../../../app';
import { sendPasswordResetEmail } from 'firebase/auth';
import { UserRepository } from '../repositories/UserRepository';

// Mock UserRepository module
jest.mock('../repositories/UserRepository');

// Mock Firebase Auth SDK
jest.mock('firebase/auth', () => {
    const original = jest.requireActual('firebase/auth');
    return {
        ...original,
        signInWithEmailAndPassword: jest.fn(),
        sendPasswordResetEmail: jest.fn()
    };
});

describe('POST /api/auth/forgot-password', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 400 when email is missing', async () => {
        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('Validation failed');
    });

    it('should return 400 when email is invalid', async () => {
        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({ email: 'invalid-email' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('Validation failed');
    });

    it('should return 200 when user email does not exist in database (prevent account enumeration)', async () => {
        (UserRepository.prototype.getByEmail as jest.Mock).mockResolvedValue(null);

        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({ email: 'nonexistent@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Password reset email sent successfully');
    });

    it('should return 200 and trigger Firebase password reset email on success', async () => {
        (UserRepository.prototype.getByEmail as jest.Mock).mockResolvedValue({
            id: 'user-id',
            email: 'user@example.com',
            displayName: 'Test User'
        });
        (sendPasswordResetEmail as jest.Mock).mockResolvedValue(undefined);

        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({ email: 'user@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Password reset email sent successfully');
        expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'user@example.com');
    });
});
