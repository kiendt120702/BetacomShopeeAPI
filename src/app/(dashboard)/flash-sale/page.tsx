"use client";

import FlashSalePanel from "@/components/panels/FlashSalePanel";
import { useShopeeAuth } from "@/hooks/useShopeeAuth";
import ConnectShopBanner from "@/components/shop/ConnectShopBanner";

export default function FlashSalePage() {
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

    return <FlashSalePanel />;
}
