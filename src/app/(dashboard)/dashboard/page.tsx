"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useShopeeAuth } from "@/hooks/useShopeeAuth";

// Dashboard Panel Component
export default function DashboardPage() {
    const router = useRouter();
    const { token, shops } = useShopeeAuth();
    const { user, profile } = useAuth();

    const currentShop = shops.find((s) => s.shop_id === token?.shop_id);
    const shopName = currentShop?.shop_name || `Shop ${token?.shop_id}`;

    const handleNavigate = (path: string) => {
        router.push(path);
    };

    return (
        <div className="p-6 space-y-6">
            {/* Welcome Banner */}
            <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-2xl p-6 text-white">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-bold mb-2">
                            Xin chào, {profile?.full_name || user?.email?.split("@")[0]}! 👋
                        </h1>
                        <p className="text-orange-100 text-sm">
                            Chào mừng bạn đến với BETACOM - Công cụ quản lý Shop Shopee
                        </p>
                        {token?.shop_id && (
                            <div className="mt-4 flex items-center gap-2 bg-white/20 rounded-lg px-3 py-2 w-fit">
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
                                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                                    />
                                </svg>
                                <span className="text-sm font-medium">{shopName}</span>
                            </div>
                        )}
                    </div>
                    <div className="hidden md:block">
                        <div className="w-24 h-24 bg-white/20 rounded-2xl flex items-center justify-center">
                            <svg
                                className="w-12 h-12 text-white"
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
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    icon={
                        <svg
                            className="w-5 h-5"
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
                    }
                    label="Flash Sale"
                    value="Quản lý"
                    color="orange"
                    onClick={() => handleNavigate("/flash-sale")}
                />
                <StatCard
                    icon={
                        <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                        </svg>
                    }
                    label="Hẹn giờ"
                    value="Tự động"
                    color="blue"
                    onClick={() => handleNavigate("/flash-sale/schedule")}
                />
                <StatCard
                    icon={
                        <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                            />
                        </svg>
                    }
                    label="Quảng cáo"
                    value="Campaigns"
                    color="purple"
                    onClick={() => handleNavigate("/ads")}
                />
                <StatCard
                    icon={
                        <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                        </svg>
                    }
                    label="Ngân sách"
                    value="Scheduler"
                    color="green"
                    onClick={() => handleNavigate("/ads")}
                />
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Flash Sale Section */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                                <svg
                                    className="w-5 h-5 text-orange-600"
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
                            <div>
                                <h3 className="font-semibold text-slate-800">
                                    Flash Sale Manager
                                </h3>
                                <p className="text-xs text-slate-500">
                                    Quản lý & hẹn giờ đăng ký
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => handleNavigate("/flash-sale")}
                            className="text-sm text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
                        >
                            Xem chi tiết
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
                                    d="M9 5l7 7-7 7"
                                />
                            </svg>
                        </button>
                    </div>
                    <div className="p-4 space-y-3">
                        <FeatureItem
                            icon="🔥"
                            title="Xem Flash Sale"
                            description="Danh sách Flash Sale đang mở đăng ký"
                        />
                        <FeatureItem
                            icon="⏰"
                            title="Hẹn giờ tự động"
                            description="Đặt lịch đăng ký sản phẩm vào Flash Sale"
                        />
                        <FeatureItem
                            icon="📊"
                            title="Theo dõi kết quả"
                            description="Xem trạng thái đăng ký và kết quả"
                        />
                    </div>
                </div>

                {/* Ads Section */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                <svg
                                    className="w-5 h-5 text-blue-600"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                                    />
                                </svg>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-800">Ads Manager</h3>
                                <p className="text-xs text-slate-500">
                                    Quản lý chiến dịch quảng cáo
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => handleNavigate("/ads")}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                        >
                            Xem chi tiết
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
                                    d="M9 5l7 7-7 7"
                                />
                            </svg>
                        </button>
                    </div>
                    <div className="p-4 space-y-3">
                        <FeatureItem
                            icon="📈"
                            title="Quản lý Campaigns"
                            description="Xem và điều chỉnh chiến dịch quảng cáo"
                        />
                        <FeatureItem
                            icon="💰"
                            title="Lên lịch ngân sách"
                            description="Tự động thay đổi ngân sách theo lịch"
                        />
                        <FeatureItem
                            icon="⚡"
                            title="Bật/Tắt nhanh"
                            description="Điều khiển trạng thái chiến dịch"
                        />
                    </div>
                </div>
            </div>

            {/* API Integration Info */}
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 p-6">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
                        <svg
                            className="w-6 h-6 text-orange-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                            />
                        </svg>
                    </div>
                    <div className="flex-1">
                        <h3 className="font-semibold text-slate-800 mb-1">
                            Tích hợp Shopee Open Platform API
                        </h3>
                        <p className="text-sm text-slate-600 mb-3">
                            Dữ liệu được đồng bộ trực tiếp từ Shopee thông qua API chính thức,
                            đảm bảo tính chính xác và real-time.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <span className="text-xs px-2 py-1 bg-white rounded-full text-slate-600 border border-slate-200">
                                🔐 Bảo mật OAuth 2.0
                            </span>
                            <span className="text-xs px-2 py-1 bg-white rounded-full text-slate-600 border border-slate-200">
                                ⚡ Real-time Sync
                            </span>
                            <span className="text-xs px-2 py-1 bg-white rounded-full text-slate-600 border border-slate-200">
                                🛡️ Official API
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Stat Card Component
function StatCard({
    icon,
    label,
    value,
    color,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    color: string;
    onClick?: () => void;
}) {
    const colorClasses: Record<string, string> = {
        orange: "bg-orange-100 text-orange-600 group-hover:bg-orange-200",
        blue: "bg-blue-100 text-blue-600 group-hover:bg-blue-200",
        purple: "bg-purple-100 text-purple-600 group-hover:bg-purple-200",
        green: "bg-green-100 text-green-600 group-hover:bg-green-200",
    };

    return (
        <button
            onClick={onClick}
            className="bg-white rounded-xl border border-slate-200 p-4 text-left hover:border-slate-300 hover:shadow-sm transition-all group"
        >
            <div className="flex items-center gap-3">
                <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${colorClasses[color]}`}
                >
                    {icon}
                </div>
                <div>
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-sm font-semibold text-slate-800">{value}</p>
                </div>
            </div>
        </button>
    );
}

// Feature Item Component
function FeatureItem({
    icon,
    title,
    description,
}: {
    icon: string;
    title: string;
    description: string;
}) {
    return (
        <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
            <span className="text-lg">{icon}</span>
            <div>
                <p className="text-sm font-medium text-slate-700">{title}</p>
                <p className="text-xs text-slate-500">{description}</p>
            </div>
        </div>
    );
}
