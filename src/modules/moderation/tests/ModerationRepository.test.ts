jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {},
  admin: { auth: jest.fn() },
}));

import { ModerationRepository } from '../repositories/ModerationRepository';

describe('ModerationRepository', () => {
  it('does not report success when warning a missing user', async () => {
    const get = jest.fn().mockResolvedValue({ empty: true, docs: [] });
    const db = {
      collection: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get,
      }),
    };
    const repository = new ModerationRepository(db as any);

    await expect(
      repository.moderateUser('missing-user', 'warn', 'admin-1', 'spam'),
    ).resolves.toBe(false);
  });
});
