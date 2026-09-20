import { PublicProduct } from './PublicProduct';
import { PublicUser } from './PublicUser';

export interface PublicProfileQuery {
  limit: number;
  cursor?: string;
}

export interface PublicProfileData {
  user: PublicUser;
  products: PublicProduct[];
}

export interface PublicProfilePage {
  data: PublicProfileData;
  meta: { limit: number; nextCursor: string | null; hasMore: boolean };
}
