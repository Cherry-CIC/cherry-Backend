export type ReportTargetType = 'product' | 'user' | 'charity';
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'rejected';

export const REPORT_TARGET_TYPES: ReportTargetType[] = [
  'product',
  'user',
  'charity',
];
export const REPORT_STATUSES: ReportStatus[] = [
  'open',
  'reviewing',
  'resolved',
  'rejected',
];

export interface Report {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  message?: string;
  status: ReportStatus;
  adminNote?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}
