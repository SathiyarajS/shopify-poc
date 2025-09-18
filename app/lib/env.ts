// Environment configuration for client and server
export const getEnvVar = (key: string, defaultValue?: string): string => {
  if (typeof window === 'undefined') {
    // Server-side
    return process.env[key] || defaultValue || '';
  } else {
    // Client-side - these should be passed from the server
    return (window as any).ENV?.[key] || defaultValue || '';
  }
};

export const getShopifyApiKey = (): string => {
  return getEnvVar('SHOPIFY_API_KEY');
};

export const getShopifyApiSecret = (): string => {
  return getEnvVar('SHOPIFY_API_SECRET');
};

export const getAppUrl = (): string => {
  return getEnvVar('SHOPIFY_APP_URL');
};