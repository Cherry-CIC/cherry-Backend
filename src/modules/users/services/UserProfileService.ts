import {
  UserProductsPage,
  UserProductsQuery,
  UserProfile,
} from '../model/UserProfile';
import { UserProductRepository } from '../repositories/UserProductRepository';
import { UserProfileRepository } from '../repositories/UserProfileRepository';
import { UserProductCursor } from './UserProductCursor';

export class UserProfileService {
  constructor(
    private readonly users: Pick<
      UserProfileRepository,
      'getByFirebaseUid'
    > = new UserProfileRepository(),
    private readonly products: Pick<
      UserProductRepository,
      'getPage'
    > = new UserProductRepository(),
    private readonly cursors: UserProductCursor = new UserProductCursor(),
  ) {}

  async getUserProfile(ownerId: string): Promise<UserProfile | null> {
    const user = await this.users.getByFirebaseUid(ownerId);
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      profileImageUrl: user.profileImageUrl,
    };
  }

  async getUserProducts(
    ownerId: string,
    viewerId: string,
    query: UserProductsQuery,
  ): Promise<UserProductsPage | null> {
    const cursor = this.cursors.decode(query.cursor, ownerId, viewerId);
    const user = await this.users.getByFirebaseUid(ownerId);
    if (!user) return null;

    const page = await this.products.getPage(
      ownerId,
      query.limit,
      cursor,
    );
    const nextCursor = page.nextPosition
      ? this.cursors.encode(page.nextPosition, ownerId, viewerId)
      : null;
    return {
      data: { products: page.products },
      meta: { limit: query.limit, nextCursor, hasMore: nextCursor !== null },
    };
  }
}
