"use client";

import { useState } from "react";

interface ConnectShopBannerProps {
    onConnect: () => void;
    error?: string | null;
    isLoading?: boolean;
    canConnect?: boolean;
}

export default function ConnectShopBanner({
    onConnect,
    error,
    isLoading,
    canConnect = true,
}: ConnectShopBannerProps) {
    const [connecting, setConnecting] = useState(false);

    const handleConnect = async () => {
        setConnecting(true);
        try {
            await onConnect();
        } catch {
            setConnecting(false);
        }
    };

    return (
        <div className="h-full flex items-center justify-center p-6">
            <div className="max-w-md text-center">
                <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg
                        className="w-8 h-8 text-orange-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                    </svg>
                </div>
                <h2 className="text-xl font-bold text-slate-800 mb-2">
                    {canConnect
                        ? "Kết nối Shop Shopee"
                        : "Chưa có quyền truy cập Shop"}
                </h2>
                <p className="text-slate-500 text-sm mb-4">
                    {canConnect
                        ? "Kết nối shop để quản lý Flash Sale, hẹn giờ và xem thông tin sản phẩm."
                        : "Liên hệ Admin để được phân quyền truy cập shop."}
                </p>
                {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                        {error}
                    </div>
                )}
                {canConnect && (
                    <button
                        onClick={handleConnect}
                        disabled={isLoading || connecting}
                        className="px-5 py-2.5 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
                    >
                        {isLoading || connecting ? (
                            <>
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle
                                        className="opacity-25"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                    />
                                    <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                    />
                                </svg>
                                Đang kết nối...
                            </>
                        ) : (
                            <>
                                <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                                    />
                                </svg>
                                Kết nối với Shopee
                            </>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}
