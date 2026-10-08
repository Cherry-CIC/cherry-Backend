import { AuthService } from '../services/AuthService';

// Prevent old synchronous callers from bypassing the durable receipt workflow.
describe('legacy account deletion', () => {
  it('requires the new deletion contract without invoking any data providers', async () => {
    await expect(new AuthService().deleteAccount('user-1')).rejects.toMatchObject({
      code: 'DELETION_CONTRACT_REQUIRED',
      status: 409,
    });
  });
});
