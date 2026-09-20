import { PublicProfileService } from './PublicProfileService';

export class ServiceFactory {
  private static publicProfileService: PublicProfileService | null = null;

  static getPublicProfileService(): PublicProfileService {
    if (!this.publicProfileService) {
      this.publicProfileService = new PublicProfileService();
    }
    return this.publicProfileService;
  }

  static reset(): void {
    this.publicProfileService = null;
  }
}
