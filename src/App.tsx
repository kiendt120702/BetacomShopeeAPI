import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/contexts/AuthContext';
import { ShopeeAuthProvider } from '@/contexts/ShopeeAuthContext';

// Layout
import MainLayout from '@/components/layout/MainLayout';

// Pages
import AuthPage from '@/pages/AuthPage';
import AuthCallback from '@/pages/AuthCallback';
import HomePage from '@/pages/HomePage';
import NotFoundPage from '@/pages/NotFoundPage';

// Settings Pages
import ProfileSettingsPage from '@/pages/settings/ProfileSettingsPage';
import ShopsSettingsPage from '@/pages/settings/ShopsSettingsPage';
import UsersSettingsPage from '@/pages/settings/UsersSettingsPage';

// Feature Pages
import FlashSalePage from '@/pages/FlashSalePage';
import FlashSaleDetailPage from '@/pages/FlashSaleDetailPage';


import FlashSaleAutoSetupPage from '@/pages/FlashSaleAutoSetupPage';
import ProductsPage from '@/pages/ProductsPage';
import OrdersPage from '@/pages/OrdersPage';
import ReviewsPage from '@/pages/ReviewsPage';
import ReviewsAutoReplyPage from '@/pages/ReviewsAutoReplyPage';
import AdsPage from '@/pages/AdsPage';
import ApiResponsePage from '@/pages/ApiResponsePage';

function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes - data considered fresh
            gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache
            refetchOnWindowFocus: false, // Don't refetch when tab becomes active
            refetchOnMount: false, // Don't refetch if data is fresh
            retry: 1, // Only retry once on failure
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ShopeeAuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                {/* Public routes */}
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/auth/callback" element={<AuthCallback />} />

                {/* Protected routes with MainLayout */}
                <Route element={<MainLayout />}>
                  <Route path="/" element={<HomePage />} />
                  {/* Feature Routes */}
                  <Route path="/orders" element={<OrdersPage />} />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/reviews" element={<ReviewsPage />} />
                  <Route path="/reviews/auto-reply" element={<ReviewsAutoReplyPage />} />
                  <Route path="/flash-sale" element={<FlashSalePage />} />
                  <Route path="/flash-sale/detail/:flashSaleId" element={<FlashSaleDetailPage />} />

                  <Route path="/flash-sale/auto-setup" element={<FlashSaleAutoSetupPage />} />
                  <Route path="/ads" element={<AdsPage />} />
                  {/* Settings Routes */}
                  <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
                  <Route path="/settings/profile" element={<ProfileSettingsPage />} />
                  <Route path="/settings/shops" element={<ShopsSettingsPage />} />
                  <Route path="/settings/users" element={<UsersSettingsPage />} />
                  <Route path="/settings/api-response" element={<ApiResponsePage />} />
                </Route>

                {/* 404 */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </ShopeeAuthProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
