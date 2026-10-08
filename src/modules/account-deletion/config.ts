export interface RetentionPolicy {
  policyVersion: string;
  orderEvidenceMonths: number;
  financialYears: number;
  financialYearEndMonth: number;
  financialYearEndDay: number;
  auditDays: number;
  backupDays: number;
  reviewDays: number;
}

export class DeletionError extends Error {
  constructor(
    public code: string,
    public status = 503,
  ) {
    super(code);
  }
}

const requiredReadiness = [
  'policy',
  'firestoreRules',
  'storageRules',
  'inventory',
  'extensions',
  'providers',
  'backups',
  'scheduler',
  'alerts',
  'support',
  'frontend',
  'apple',
];

export function extensionConfigurationEvidence(env = process.env): string {
  if (env.ACCOUNT_DELETION_MODE === 'emulator')
    return 'isolated-emulator-no-extension';
  try {
    const evidence = JSON.parse(
      env.ACCOUNT_DELETION_READINESS || '',
    ).extensions;
    if (typeof evidence === 'string' && evidence.trim().length >= 8)
      return evidence;
  } catch {
    /* Missing evidence fails closed below. */
  }
  throw new DeletionError('EXTENSION_CONFIGURATION_REVIEW_REQUIRED');
}

export function loadDeletionPolicy(env = process.env): RetentionPolicy {
  if (!['emulator', 'production'].includes(env.ACCOUNT_DELETION_MODE || '')) {
    throw new DeletionError('DELETION_UNAVAILABLE');
  }
  if (env.ACCOUNT_DELETION_MODE === 'emulator') {
    const local = /^(localhost|127\.0\.0\.1):\d+$/;
    if (
      !env.FIREBASE_PROJECT_ID?.startsWith('demo-') ||
      ![
        env.FIRESTORE_EMULATOR_HOST,
        env.FIREBASE_AUTH_EMULATOR_HOST,
        env.FIREBASE_STORAGE_EMULATOR_HOST,
      ].every((v) => local.test(v || ''))
    ) {
      throw new DeletionError('EMULATOR_CONFIGURATION_REQUIRED');
    }
  }
  let policy: RetentionPolicy;
  try {
    policy = JSON.parse(env.ACCOUNT_DELETION_POLICY || '');
  } catch {
    throw new DeletionError('POLICY_CONFIGURATION_REQUIRED');
  }
  if (
    !policy ||
    typeof policy.policyVersion !== 'string' ||
    !policy.policyVersion.trim()
  ) {
    throw new DeletionError('POLICY_CONFIGURATION_REQUIRED');
  }
  const bounds: Record<string, [number, number]> = {
    orderEvidenceMonths: [0, 120],
    financialYears: [0, 20],
    financialYearEndMonth: [1, 12],
    financialYearEndDay: [1, 31],
    auditDays: [8, 365],
    backupDays: [0, 365],
    reviewDays: [1, 28],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const value = (policy as unknown as Record<string, unknown>)[key];
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      throw new DeletionError('POLICY_CONFIGURATION_REQUIRED');
    }
  }
  if (policy.auditDays < policy.backupDays)
    throw new DeletionError('AUDIT_MUST_COVER_BACKUP_HORIZON');
  const date = new Date(
    Date.UTC(
      2025,
      policy.financialYearEndMonth - 1,
      policy.financialYearEndDay,
    ),
  );
  if (date.getUTCMonth() !== policy.financialYearEndMonth - 1) {
    throw new DeletionError('POLICY_CONFIGURATION_REQUIRED');
  }
  if (env.ACCOUNT_DELETION_MODE === 'production') {
    let readiness: Record<string, string>;
    try {
      readiness = JSON.parse(env.ACCOUNT_DELETION_READINESS || '');
    } catch {
      throw new DeletionError('PRODUCTION_READINESS_REQUIRED');
    }
    if (
      env.ACCOUNT_DELETION_APPROVED_POLICY !== policy.policyVersion ||
      !readiness ||
      !requiredReadiness.every(
        (key) =>
          typeof readiness[key] === 'string' &&
          readiness[key].trim().length >= 8,
      )
    ) {
      throw new DeletionError('PRODUCTION_READINESS_REQUIRED');
    }
  }
  return policy;
}

export function ordinaryResponseDeadline(receivedAt: Date): Date {
  const deadline = new Date(receivedAt);
  const day = deadline.getUTCDate();
  deadline.setUTCDate(1);
  deadline.setUTCMonth(deadline.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth() + 1, 0),
  ).getUTCDate();
  deadline.setUTCDate(Math.min(day, lastDay));
  return deadline;
}
