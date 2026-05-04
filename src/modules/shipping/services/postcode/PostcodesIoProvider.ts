import axios from 'axios';
import {
  PostcodeLookupProvider,
  PostcodeValidationResult,
} from './PostcodeLookupProvider';

interface PostcodesIoResponse {
  status: number;
  result: {
    postcode: string;
    region: string | null;
    country: string | null;
    admin_district: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
}

export class PostcodesIoProvider implements PostcodeLookupProvider {
  private readonly baseUrl = 'https://api.postcodes.io';

  async validatePostcode(
    postcode: string,
  ): Promise<PostcodeValidationResult | null> {
    try {
      const encoded = encodeURIComponent(postcode.trim());
      const { data } = await axios.get<PostcodesIoResponse>(
        `${this.baseUrl}/postcodes/${encoded}`,
      );

      if (data.status !== 200 || !data.result) {
        return null;
      }

      return {
        postcode: data.result.postcode,
        // Frontend expects a city field. For UK postcodes, region is the best
        // stable source for "London", "South East", etc.
        city: data.result.region || '',
        region: data.result.region || '',
        country: data.result.country || '',
        adminDistrict: data.result.admin_district || '',
        latitude: data.result.latitude,
        longitude: data.result.longitude,
      };
    } catch {
      return null;
    }
  }
}
