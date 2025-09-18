import React, { createContext, useContext, useEffect } from 'react';
import { useShopifySession, UseShopifySessionResult } from '../hooks/useShopifySession';
import { generateOAuthUrl } from '../lib/shopifySession';
import { getShopifyApiKey } from '../lib/env';
import { Page, Card, Text, Button, Spinner, Banner } from '@shopify/polaris';

const ShopifySessionContext = createContext<UseShopifySessionResult | null>(null);

export const useShopifySessionContext = () => {
  const context = useContext(ShopifySessionContext);
  if (!context) {
    throw new Error('useShopifySessionContext must be used within ShopifySessionProvider');
  }
  return context;
};

interface ShopifySessionProviderProps {
  children: React.ReactNode;
  fallbackShopId?: string;
  scopes?: string[];
  clientId?: string;
  redirectUri?: string;
}

export const ShopifySessionProvider: React.FC<ShopifySessionProviderProps> = ({
  children,
  fallbackShopId,
  scopes = ['read_products', 'write_products'],
  clientId,
  redirectUri = '/auth/shopify/callback',
}) => {
  const sessionResult = useShopifySession(fallbackShopId);
  const { session, isLoading, error, needsReload, needsOAuth } = sessionResult;
  
  // Get clientId from environment if not provided
  const effectiveClientId = clientId || getShopifyApiKey();

  // Handle OAuth redirect
  const handleOAuthRedirect = () => {
    if (!session?.shop || !effectiveClientId) return;
    
    const authUrl = generateOAuthUrl(session.shop, effectiveClientId, scopes, redirectUri);
    window.location.href = authUrl;
  };

  // Handle page reload for embedded apps
  const handleReload = () => {
    window.location.reload();
  };

  // Show loading state
  if (isLoading) {
    return (
      <Page>
        <Card>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Spinner size="large" />
            <Text variant="headingMd" as="h2">
              Initializing session...
            </Text>
          </div>
        </Card>
      </Page>
    );
  }

  // Show error states
  if (needsReload) {
    return (
      <Page>
        <Card>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Banner tone="warning" title="Session Expired">
              <p>Your session has expired. Please reload the app to continue.</p>
            </Banner>
            <div style={{ marginTop: '1rem' }}>
              <Button variant="primary" onClick={handleReload}>
                Reload App
              </Button>
            </div>
          </div>
        </Card>
      </Page>
    );
  }

  if (needsOAuth) {
    return (
      <Page>
        <Card>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Banner tone="info" title="Authentication Required">
              <p>Please authenticate to continue using the app.</p>
            </Banner>
            <div style={{ marginTop: '1rem' }}>
              <Button variant="primary" onClick={handleOAuthRedirect} disabled={!session?.shop || !effectiveClientId}>
                Authenticate with Shopify
              </Button>
            </div>
          </div>
        </Card>
      </Page>
    );
  }

  if (error && !session) {
    return (
      <Page>
        <Card>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Banner tone="critical" title="Authentication Error">
              <p>{error}</p>
            </Banner>
            <div style={{ marginTop: '1rem' }}>
              <Button onClick={() => sessionResult.refreshSession()}>
                Retry
              </Button>
            </div>
          </div>
        </Card>
      </Page>
    );
  }

  // Session is valid, render children
  return (
    <ShopifySessionContext.Provider value={sessionResult}>
      {children}
    </ShopifySessionContext.Provider>
  );
};