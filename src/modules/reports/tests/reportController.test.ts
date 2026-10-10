import {
  createReport,
  listAdminReports,
  updateAdminReportStatus,
} from '../controllers/reportController';

const mockCreate = jest.fn();
const mockList = jest.fn();
const mockUpdateStatus = jest.fn();

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
