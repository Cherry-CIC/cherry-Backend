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
    return pickupPoints.map((point: any) => this.normalizePickupPoint(point));
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
    const addressParts = [point?.street, point?.house_number].filter(Boolean);

    return {
      id: String(point?.id ?? ''),
      name: point?.name || 'Pickup point',
      addressLine1: addressParts.join(' ').trim(),
      city: point?.city || '',
      postalCode: point?.postal_code || '',
      country: point?.country || '',
      carrier: point?.carrier || null,
      distanceMeters:
        typeof point?.distance === 'number'
          ? point.distance
          : point?.distance
            ? Number(point.distance)
            : null,
      latitude: point?.latitude ? String(point.latitude) : null,
      longitude: point?.longitude ? String(point.longitude) : null,
      openTomorrow: Boolean(point?.open_tomorrow),
      openUpcomingWeek: Boolean(point?.open_upcoming_week),
    };
  }
}
