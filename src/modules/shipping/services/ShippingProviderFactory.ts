import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';
import { SendcloudService } from './SendcloudService';
import { MockShippingProvider } from './MockShippingProvider';
import { ShippingProvider } from './ShippingProvider';

export const createShippingProvider = (): ShippingProvider => {
  if (sendcloudConfig.mode === 'mock') {
    return new MockShippingProvider();
  }

  return new SendcloudService();
};
