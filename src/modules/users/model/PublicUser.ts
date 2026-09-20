/** The complete public user contract. Account fields must never be added here. */
export interface PublicUser {
  id: string;
  username: string;
  profileImageUrl: string | null;
}
