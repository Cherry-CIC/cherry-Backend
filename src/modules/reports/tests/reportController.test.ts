import {
  createReport,
  listAdminReports,
  updateAdminReportStatus,
} from '../controllers/reportController';

const mockCreate = jest.fn();
const mockList = jest.fn();
const mockUpdateStatus = jest.fn();
const errorLog = jest
  .spyOn(console, 'error')
  .mockImplementation(() => undefined);

jest.mock('../repositories/ReportRepository', () => ({
  ReportRepository: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    list: mockList,
    updateStatus: mockUpdateStatus,
  })),
}));

const response = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('reportController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    errorLog.mockClear();
  });

  it('creates a product report for the authenticated user', async () => {
    mockCreate.mockResolvedValue({ id: 'report-1', status: 'open' });
    const req: any = {
      user: { uid: 'user-1' },
      body: {
        targetType: 'product',
        targetId: 'product-1',
        reason: 'prohibited_item',
        message: 'Unsafe listing',
      },
    };
    const res = response();

    await createReport(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreate).toHaveBeenCalledWith({
      reporterId: 'user-1',
      targetType: 'product',
      targetId: 'product-1',
      reason: 'prohibited_item',
      message: 'Unsafe listing',
    });
  });

  it('rejects reporting yourself', async () => {
    const res = response();

    await createReport(
      {
        user: { uid: 'user-1' },
        body: { targetType: 'user', targetId: 'user-1', reason: 'abuse' },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a charity report for the authenticated user', async () => {
    mockCreate.mockResolvedValue({ id: 'report-charity-1', status: 'open' });
    const res = response();

    await createReport(
      {
        user: { uid: 'user-1' },
        body: {
          targetType: 'charity',
          targetId: 'charity-dogs-trust',
          reason: 'misleading_info',
          message: 'Broken details',
        },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreate).toHaveBeenCalledWith({
      reporterId: 'user-1',
      targetType: 'charity',
      targetId: 'charity-dogs-trust',
      reason: 'misleading_info',
      message: 'Broken details',
    });
  });

  it('rejects unsafe charity target identifiers', async () => {
    const res = response();

    await createReport(
      {
        user: { uid: 'user-1' },
        body: {
          targetType: 'charity',
          targetId: '../other-collection',
          reason: 'abuse',
        },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not return raw report creation errors', async () => {
    mockCreate.mockRejectedValue(
      new Error('firestore private@example.org internal-index-detail'),
    );
    const res = response();

    await createReport(
      {
        user: { uid: 'user-1' },
        body: {
          targetType: 'product',
          targetId: 'product-1',
          reason: 'prohibited_item',
        },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(
      /private@example.org|internal-index-detail/,
    );
    expect(errorLog).toHaveBeenCalledWith('reports.create_failed');
  });

  it('lists admin reports with filters', async () => {
    mockList.mockResolvedValue({ reports: [], nextCursor: null, hasMore: false });
    const res = response();

    await listAdminReports(
      { query: { status: 'open', targetType: 'product', limit: '10' } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockList).toHaveBeenCalledWith({
      status: 'open',
      targetType: 'product',
      limit: 10,
      cursor: undefined,
    });
  });

  it('updates report status as the authenticated admin', async () => {
    mockUpdateStatus.mockResolvedValue({ id: 'report-1', status: 'resolved' });
    const res = response();

    await updateAdminReportStatus(
      {
        user: { uid: 'admin-1' },
        params: { reportId: 'report-1' },
        body: { status: 'resolved', note: 'Handled' },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      'report-1',
      'resolved',
      'admin-1',
      'Handled',
    );
  });
});
