import { PublicProfilePage, PublicProfileQuery } from '../model/PublicProfile';
import { PublicProductRepository } from '../repositories/PublicProductRepository';
import { PublicUserRepository } from '../repositories/PublicUserRepository';
import { PublicProfileCursor } from './PublicProfileCursor';

export class PublicProfileService {
  constructor(
    private readonly users: Pick<
      PublicUserRepository,
      'getByFirebaseUid'
    > = new PublicUserRepository(),
    private readonly products: Pick<
      PublicProductRepository,
      'getPublicPage'
    > = new PublicProductRepository(),
    private readonly cursors: PublicProfileCursor = new PublicProfileCursor(),
  ) {}

  async getPublicProfile(
    ownerId: string,
    viewerId: string,
    query: PublicProfileQuery,
  ): Promise<PublicProfilePage | null> {
    const cursor = this.cursors.decode(query.cursor, ownerId, viewerId);
    const user = await this.users.getByFirebaseUid(ownerId);
    if (!user) return null;

    const page = await this.products.getPublicPage(
      ownerId,
      query.limit,
      cursor,
    );
    const nextCursor = page.nextPosition
      ? this.cursors.encode(page.nextPosition, ownerId, viewerId)
      : null;
    return {
      data: {
        user: {
          id: user.id,
          username: user.username,
          profileImageUrl: user.profileImageUrl,
        },
        products: page.products,
      },
      meta: { limit: query.limit, nextCursor, hasMore: nextCursor !== null },
    };
  }
}
