'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function TestShopeePage() {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const testConnection = async () => {
    setLoading(true);
    setResult('Testing...\n');

    try {
      // Test 1: Check Supabase connection
      setResult(prev => prev + '1. Checking Supabase connection...\n');
      const { data: session } = await supabase.auth.getSession();
      setResult(prev => prev + `   Session: ${session?.session ? 'Yes' : 'No'}\n`);

      // Test 2: Call Edge Function
      setResult(prev => prev + '2. Calling apishopee-auth Edge Function...\n');
      
      const partnerInfo = {
        partner_id: 2012946,
        partner_key: 'shpk504156696b55776a70566159524c59736150715674664742454f74587475',
        partner_name: 'King Monster',
      };

      const { data, error } = await supabase.functions.invoke('apishopee-auth', {
        body: {
          action: 'get-auth-url',
          redirect_uri: 'https://ops.betacom.agency/auth/callback',
          partner_info: partnerInfo,
        },
      });

      setResult(prev => prev + `   Error: ${error ? JSON.stringify(error) : 'None'}\n`);
      setResult(prev => prev + `   Data: ${JSON.stringify(data, null, 2)}\n`);

      if (data?.auth_url) {
        setResult(prev => prev + `\n3. SUCCESS! Auth URL received.\n`);
        setResult(prev => prev + `   Click button below to redirect to Shopee.\n`);
      }
    } catch (err: any) {
      setResult(prev => prev + `\nERROR: ${err.message}\n`);
    } finally {
      setLoading(false);
    }
  };

  const redirectToShopee = async () => {
    const partnerInfo = {
      partner_id: 2012946,
      partner_key: 'shpk504156696b55776a70566159524c59736150715674664742454f74587475',
      partner_name: 'King Monster',
    };

    const { data } = await supabase.functions.invoke('apishopee-auth', {
      body: {
        action: 'get-auth-url',
        redirect_uri: 'https://ops.betacom.agency/auth/callback',
        partner_info: partnerInfo,
      },
    });

    if (data?.auth_url) {
      window.location.href = data.auth_url;
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Test Shopee Connection</h1>
      
      <div className="space-y-4">
        <button
          onClick={testConnection}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Edge Function'}
        </button>

        <button
          onClick={redirectToShopee}
          className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 ml-2"
        >
          Redirect to Shopee
        </button>
      </div>

      <pre className="mt-4 p-4 bg-gray-100 rounded text-sm whitespace-pre-wrap">
        {result || 'Click "Test Edge Function" to start'}
      </pre>
    </div>
  );
}
