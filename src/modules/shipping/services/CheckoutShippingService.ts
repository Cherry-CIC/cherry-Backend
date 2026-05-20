import { SendcloudService } from './SendcloudService';

export interface CheckoutShippingOptionsQuery {
  servicePointId: string;
  country: string;
  postalCode: string;
  isReturn?: boolean;
  carrier?: string;
}

export interface PickupPointsQuery {
  country: string;
  address: string;
  carrier?: string;
  radius?: number;
}

export interface NormalizedShippingOption {
  id: string;
  name: string;
  description?: string;
  deliveryType: 'home' | 'pickup_point';
  deliveryMethodType: string;
  price: string | null;
  currency: string | null;
  carrierCode: string | null;
  carrierName: string | null;
  checkoutIdentifier: string | null;
}

export interface NormalizedPickupPoint {
  id: string;
  name: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  country: string;
  carrier: string | null;
  distanceMeters: number | null;
  latitude: string | null;
  longitude: string | null;
  openTomorrow: boolean;
  openUpcomingWeek: boolean;
}

export class CheckoutShippingService {
  constructor(private readonly sendcloudService = new SendcloudService()) {}

  async getDeliveryOptions(query: CheckoutShippingOptionsQuery): Promise<NormalizedShippingOption[]> {
    const deliveryOptions = await this.sendcloudService.getCheckoutDeliveryOptions(query);
    return deliveryOptions
      .map((option: any) => this.normalizeDeliveryOption(option, query.country))
      .filter((option) => option.deliveryType === 'pickup_point');
  }

  async getPickupPoints(query: PickupPointsQuery): Promise<NormalizedPickupPoint[]> {
    const pickupPoints = await this.sendcloudService.getServicePoints(query);
    return pickupPoints
      .map((point: any) => this.normalizePickupPoint(point))
      .filter((point) => this.hasRequiredPickupPointFields(point));
  }

  private normalizeDeliveryOption(
    option: any,
    destinationCountry: string,
  ): NormalizedShippingOption {
    const matchingCountryPrice = Array.isArray(option?.countries)
      ? option.countries.find(
          (country: any) =>
            String(country?.iso_2 || '').toUpperCase() ===
            destinationCountry.toUpperCase(),
        )?.price
      : undefined;

    const priceAmount =
      option?.shipping_rate?.value ??
      matchingCountryPrice ??
      option?.price?.amount ??
      option?.price ??
      option?.total_price?.amount ??
      option?.total_price ??
      null;

    const currency =
      option?.shipping_rate?.currency ??
      option?.price?.currency ??
      option?.total_price?.currency ??
      option?.currency ??
      null;

    const requiresServicePoint =
      String(option?.service_point_input || '').toLowerCase() === 'required';
    const deliveryMethodType = requiresServicePoint
      ? 'service_point_delivery'
      : 'home_delivery';
    const deliveryType = requiresServicePoint
      ? 'pickup_point'
      : 'home';

    return {
      id: String(option?.id ?? option?.checkout_identifier?.value ?? ''),
      name: option?.title || option?.name || 'Delivery option',
      description: option?.description || undefined,
      deliveryType,
      deliveryMethodType,
      price: priceAmount !== null && priceAmount !== undefined ? String(priceAmount) : null,
      currency,
      carrierCode: option?.carrier?.code || option?.carrier_code || null,
      carrierName: option?.carrier?.name || option?.carrier_name || null,
      checkoutIdentifier: option?.checkout_identifier?.value
        ? String(option.checkout_identifier.value)
        : String(option?.id ?? ''),
    };
  }

  private normalizePickupPoint(point: any): NormalizedPickupPoint {
    const nestedAddress = point?.address || {};
    const street =
      point?.street ||
      point?.addressLine1 ||
      point?.address_line_1 ||
      point?.line1 ||
      nestedAddress?.street ||
      nestedAddress?.line1 ||
      nestedAddress?.address_line_1 ||
      '';
    const houseNumber =
      point?.house_number ||
      point?.houseNumber ||
      nestedAddress?.house_number ||
      nestedAddress?.houseNumber ||
      '';
    const addressParts = [street, houseNumber].filter(Boolean);
    const carrier =
      point?.carrier?.code ||
      point?.carrier_code ||
      point?.carrier ||
      point?.carrierName ||
      null;

    return {
      id: String(point?.id ?? point?.service_point_id ?? point?.code ?? ''),
      name: point?.name || 'Pickup point',
      addressLine1:
        addressParts.join(' ').trim() ||
        String(nestedAddress?.addressLine1 || nestedAddress?.address || '').trim(),
      city: point?.city || nestedAddress?.city || '',
      postalCode:
        point?.postal_code ||
        point?.postalCode ||
        point?.postcode ||
        nestedAddress?.postal_code ||
        nestedAddress?.postalCode ||
        nestedAddress?.postcode ||
        '',
      country: String(point?.country || nestedAddress?.country || '').toUpperCase(),
      carrier: carrier ? String(carrier).toLowerCase() : null,
      distanceMeters:
        this.readNumber(point?.distanceMeters ?? point?.distance) ?? null,
      latitude: this.readString(point?.latitude ?? point?.lat),
      longitude: this.readString(point?.longitude ?? point?.long ?? point?.lng),
      openTomorrow: this.readBoolean(point?.openTomorrow ?? point?.open_tomorrow),
      openUpcomingWeek: this.readBoolean(
        point?.openUpcomingWeek ?? point?.open_upcoming_week,
      ),
    };
  }

  private hasRequiredPickupPointFields(point: NormalizedPickupPoint): boolean {
    return [
      point.id,
      point.name,
      point.addressLine1,
      point.city,
      point.postalCode,
      point.country,
    ].every((value) => value.trim().length > 0);
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private readString(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
  }

  private readBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }

    return Boolean(value);
  }
}
