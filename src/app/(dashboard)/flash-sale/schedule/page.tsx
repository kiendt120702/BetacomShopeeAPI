"use client";

import ScheduledPanel from "@/components/panels/ScheduledPanel";
import { useShopeeAuth } from "@/hooks/useShopeeAuth";
import ConnectShopBanner from "@/components/shop/ConnectShopBanner";

export default function FlashSaleSchedulePage() {
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

    return <ScheduledPanel />;
}
