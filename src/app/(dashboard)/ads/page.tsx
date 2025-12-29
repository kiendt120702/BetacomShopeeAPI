"use client";

import AdsPanel from "@/components/panels/AdsPanel";
import { useShopeeAuth } from "@/hooks/useShopeeAuth";
import ConnectShopBanner from "@/components/shop/ConnectShopBanner";

export default function AdsPage() {
    const { token, login: connectShopee, error: shopeeError } = useShopeeAuth();
    const isShopConnected = !!token?.shop_id;

    if (!isShopConnected) {
        return (
            <ConnectShopBanner
                onConnect={connectShopee}
                error={shopeeError}
                canConnect={true}
            />
        );
    }

    return <AdsPanel />;
}
