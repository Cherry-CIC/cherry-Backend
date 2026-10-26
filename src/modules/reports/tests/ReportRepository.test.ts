jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {},
}));

import { ReportRepository } from '../repositories/ReportRepository';

const createFixture = () => {
  const report = {
    reporterId: 'user-1',
    targetType: 'product',
    targetId: 'product-1',
    reason: 'prohibited_item',
    status: 'resolved',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const productRef = { path: 'products/product-1' };
  const reportRef = {
    id: 'report-1',
    path: 'reports/report-1',
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue({ exists: true, data: () => report }),
  };
  const transaction = {
    get: jest.fn(async (ref) => ({
      exists: true,
      data: () => (ref === reportRef ? report : {}),
    })),
    create: jest.fn(),
    update: jest.fn(),
  };
  const db = {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => (name === 'products' ? productRef : reportRef)),
    })),
    runTransaction: jest.fn(async (callback) => callback(transaction)),
  };
  return {
    report,
    productRef,
    reportRef,
    transaction,
    db,
    repository: new ReportRepository(db as any),
  };
};

describe('ReportRepository', () => {
  it('creates product reports atomically with a write that serialises listing deletion', async () => {
    const { repository, productRef, reportRef, transaction, db } =
      createFixture();

    const result = await repository.create({
      reporterId: 'user-1',
      targetType: 'product',
      targetId: 'product-1',
      reason: 'prohibited_item',
    });

    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(transaction.get).toHaveBeenCalledWith(productRef);
    expect(transaction.update).toHaveBeenCalledWith(productRef, {
      reportRevision: expect.anything(),
    });
    expect(transaction.create).toHaveBeenCalledWith(
      reportRef,
      expect.objectContaining({ targetId: 'product-1', status: 'open' }),
    );
    expect(reportRef.set).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'report-1', status: 'open' });
  });

  it('does not create a report if the listing has already been deleted', async () => {
    const { repository, transaction, reportRef } = createFixture();
    transaction.get.mockResolvedValueOnce({ exists: false, data: () => ({}) });

    await expect(
      repository.create({
        reporterId: 'user-1',
        targetType: 'product',
        targetId: 'product-1',
        reason: 'prohibited_item',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'LISTING_NOT_FOUND' });

    expect(transaction.create).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
    expect(reportRef.set).not.toHaveBeenCalled();
  });

  it('preserves user report creation without checking product documents', async () => {
    const { repository, db, reportRef } = createFixture();

    await repository.create({
      reporterId: 'user-1',
      targetType: 'user',
      targetId: 'user-2',
      reason: 'abuse',
    });

    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(reportRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'user', targetId: 'user-2' }),
    );
  });

  it.each(['open', 'reviewing'] as const)(
    'clears resolution metadata and serialises deletion when setting a product report to %s',
    async (status) => {
      const { repository, transaction, reportRef, productRef } =
        createFixture();

      await repository.updateStatus('report-1', status, 'admin-1');

      expect(transaction.get).toHaveBeenCalledWith(reportRef);
      expect(transaction.get).toHaveBeenCalledWith(productRef);
      expect(transaction.update).toHaveBeenCalledWith(productRef, {
        reportRevision: expect.anything(),
      });
      expect(transaction.update).toHaveBeenCalledWith(
        reportRef,
        expect.objectContaining({
          status,
          resolvedAt: expect.anything(),
          resolvedBy: expect.anything(),
        }),
      );
    },
  );

  it('does not reopen a product report when its listing has been deleted', async () => {
    const { repository, transaction, report } = createFixture();
    transaction.get
      .mockResolvedValueOnce({ exists: true, data: () => report })
      .mockResolvedValueOnce({ exists: false, data: () => ({}) });

    await expect(
      repository.updateStatus('report-1', 'open', 'admin-1'),
    ).rejects.toMatchObject({ status: 404, code: 'LISTING_NOT_FOUND' });

    expect(transaction.update).not.toHaveBeenCalled();
  });

  it.each(['resolved', 'rejected'] as const)(
    'allows historical product reports to be %s without requiring a surviving listing',
    async (status) => {
      const { repository, transaction, reportRef } = createFixture();

      await repository.updateStatus('report-1', status, 'admin-1', 'Reviewed');

      expect(transaction.get).toHaveBeenCalledTimes(1);
      expect(transaction.update).toHaveBeenCalledTimes(1);
      expect(transaction.update).toHaveBeenCalledWith(
        reportRef,
        expect.objectContaining({
          status,
          adminNote: 'Reviewed',
          resolvedBy: 'admin-1',
        }),
      );
    },
  );

  it('preserves reopening user reports without checking products', async () => {
    const { repository, transaction, report } = createFixture();
    report.targetType = 'user';

    await repository.updateStatus('report-1', 'open', 'admin-1');

    expect(transaction.get).toHaveBeenCalledTimes(1);
    expect(transaction.update).toHaveBeenCalledTimes(1);
  });

  it('returns null without writes for a missing report', async () => {
    const { repository, transaction } = createFixture();
    transaction.get.mockResolvedValueOnce({ exists: false, data: () => ({}) });

    await expect(
      repository.updateStatus('missing', 'open', 'admin-1'),
    ).resolves.toBeNull();

    expect(transaction.update).not.toHaveBeenCalled();
  });
});
