import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';
import { ListingSafetyError } from '../../../shared/utils/listingSafety';
import { Report, ReportStatus, ReportTargetType } from '../model/Report';

export interface CreateReportInput {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  message?: string;
}

export interface ListReportsInput {
  status?: ReportStatus;
  targetType?: ReportTargetType;
  limit: number;
  cursor?: string;
}

export interface ReportPage {
  reports: Report[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class ReportRepository {
  constructor(private readonly db = firestore) {}

  async create(input: CreateReportInput): Promise<Report> {
    const ref = this.db.collection('reports').doc();
    const now = new Date();
    const report = {
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      ...(input.message ? { message: input.message } : {}),
      status: 'open' as ReportStatus,
      createdAt: now,
      updatedAt: now,
    };
    if (input.targetType === 'product') {
      await this.db.runTransaction(async (transaction) => {
        const productRef = await this.requireProduct(
          transaction,
          input.targetId,
        );
        // Share a write with deletion as well as the product existence read.
        // This prevents a report committing against a concurrently removed listing.
        transaction.update(productRef, {
          reportRevision: FieldValue.increment(1),
        });
        transaction.create(ref, report);
      });
    } else {
      await ref.set(report);
    }
    return { id: ref.id, ...report };
  }

  async list(input: ListReportsInput): Promise<ReportPage> {
    let query: FirebaseFirestore.Query = this.db.collection('reports');
    if (input.status) query = query.where('status', '==', input.status);
    if (input.targetType) {
      query = query.where('targetType', '==', input.targetType);
    }
    query = query
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (input.cursor) {
      const cursor = await this.db
        .collection('reports')
        .doc(input.cursor)
        .get();
      if (!cursor.exists) throw new Error('cursor_not_found');
      query = query.startAfter(cursor);
    }
    const snapshot = await query.limit(input.limit + 1).get();
    const docs = snapshot.docs.slice(0, input.limit);
    return {
      reports: docs.map((doc) => this.map(doc.id, doc.data())),
      nextCursor:
        snapshot.docs.length > input.limit ? docs[docs.length - 1].id : null,
      hasMore: snapshot.docs.length > input.limit,
    };
  }

  async getById(id: string): Promise<Report | null> {
    const doc = await this.db.collection('reports').doc(id).get();
    return doc.exists ? this.map(doc.id, doc.data()!) : null;
  }

  async updateStatus(
    id: string,
    status: ReportStatus,
    adminId: string,
    note?: string,
  ): Promise<Report | null> {
    const ref = this.db.collection('reports').doc(id);
    const updates: Record<string, unknown> = {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      ...(note ? { adminNote: note } : {}),
    };
    if (status === 'resolved' || status === 'rejected') {
      updates.resolvedAt = FieldValue.serverTimestamp();
      updates.resolvedBy = adminId;
    } else {
      updates.resolvedAt = FieldValue.delete();
      updates.resolvedBy = FieldValue.delete();
    }
    const exists = await this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists) return false;
      const data = doc.data()!;
      if (
        data.targetType === 'product' &&
        (status === 'open' || status === 'reviewing')
      ) {
        const productRef = await this.requireProduct(
          transaction,
          data.targetId,
        );
        transaction.update(productRef, {
          reportRevision: FieldValue.increment(1),
        });
      }
      transaction.update(ref, updates);
      return true;
    });
    if (!exists) return null;
    return this.getById(id);
  }

  private async requireProduct(
    transaction: FirebaseFirestore.Transaction,
    productId: string,
  ): Promise<FirebaseFirestore.DocumentReference> {
    const ref = this.db.collection('products').doc(productId);
    const product = await transaction.get(ref);
    if (!product.exists) {
      throw new ListingSafetyError(
        404,
        'LISTING_NOT_FOUND',
        'This listing is no longer available.',
      );
    }
    return ref;
  }

  private map(id: string, data: FirebaseFirestore.DocumentData): Report {
    return {
      id,
      ...data,
      createdAt: this.toDate(data.createdAt),
      updatedAt: this.toDate(data.updatedAt),
      ...(data.resolvedAt ? { resolvedAt: this.toDate(data.resolvedAt) } : {}),
    } as Report;
  }

  private toDate(value: unknown): Date {
    if (value instanceof Timestamp) return value.toDate();
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
  }
}
