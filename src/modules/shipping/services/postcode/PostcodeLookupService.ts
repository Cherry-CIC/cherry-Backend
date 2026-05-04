import {
  PostcodeLookupProvider,
  PostcodeValidationResult,
} from './PostcodeLookupProvider';
import { PostcodesIoProvider } from './PostcodesIoProvider';

export class PostcodeLookupService {
  constructor(private readonly provider: PostcodeLookupProvider = new PostcodesIoProvider()) {}

  validatePostcode(postcode: string): Promise<PostcodeValidationResult | null> {
    return this.provider.validatePostcode(postcode);
  }
}
