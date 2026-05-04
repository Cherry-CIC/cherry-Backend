export interface PostcodeValidationResult {
  postcode: string;
  city: string;
  region: string;
  country: string;
  adminDistrict: string;
  latitude: number | null;
  longitude: number | null;
}

export interface PostcodeLookupProvider {
  validatePostcode(
    postcode: string,
  ): Promise<PostcodeValidationResult | null>;
}
