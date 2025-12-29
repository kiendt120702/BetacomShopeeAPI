"use client";

/**
 * Dashboard Layout - Modern SPA Layout with Sidebar
 * Hỗ trợ Demo Mode cho Shopee API Review
 */

import { useState, useMemo, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useShopeeAuth } from "@/hooks/useShopeeAuth";
import { cn } from "@/lib/utils";

type MenuId =
    | "dashboard"
    | "flash-sale"
    | "flash-sale-list"
    | "flash-sale-schedule"
    | "ads"
    | "ads-budget"
    | "ads-manage"
    | "profile"
    | "profile-info"
    | "profile-users"
    | "profile-shops";

interface MenuItem {
    id: MenuId;
    path: string;
    label: string;
    icon: React.ReactNode;
    description?: string;
    children?: MenuItem[];
}

const menuItems: MenuItem[] = [
    {
        id: "dashboard",
        path: "/dashboard",
        label: "Tổng quan",
        icon: <DashboardIcon />,
        description: "Giới thiệu các chức năng",
    },
    {
        id: "flash-sale",
        path: "/flash-sale",
        label: "Flash Sale",
        icon: <FlameIcon />,
        description: "Quản lý Flash Sale & Lịch hẹn giờ",
        children: [
            {
                id: "flash-sale-list",
                path: "/flash-sale",
                label: "Flash Sale",
                icon: <FlameIcon />,
            },
            {
                id: "flash-sale-schedule",
                path: "/flash-sale/schedule",
                label: "Lịch hẹn giờ",
                icon: <ClockIcon />,
            },
        ],
    },
    {
        id: "ads",
        path: "/ads",
        label: "Quảng cáo",
        icon: <AdsIcon />,
        description: "Quản lý chiến dịch quảng cáo",
    },
    {
        id: "profile",
        path: "/profile",
        label: "Tài khoản",
        icon: <UserIcon />,
        description: "Thông tin tài khoản của bạn",
        children: [
            {
                id: "profile-info",
                path: "/profile",
                label: "Thông tin cá nhân",
                icon: <UserIcon />,
            },
            {
                id: "profile-users",
                path: "/profile/users",
                label: "Quản lý User",
                icon: <UsersIcon />,
            },
            {
                id: "profile-shops",
                path: "/profile/shops",
                label: "Quản lý Shop",
                icon: <ShopIcon />,
            },
        ],
    },
];

// Icons
function DashboardIcon() {
    return (
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
                d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
            />
        </svg>
    );
}

function FlameIcon() {
    return (
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
                d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
            />
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"
            />
        </svg>
    );
}

function ClockIcon() {
    return (
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
    );
}

function AdsIcon() {
    return (
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
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
            />
        </svg>
    );
}

function UserIcon() {
    return (
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
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
        </svg>
    );
}

function UsersIcon() {
    return (
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
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
        </svg>
    );
}

function ShopIcon() {
    return (
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
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
            />
        </svg>
    );
}

// Shop Selector Component
function ShopSelector() {
    const { token, shops, selectedShopId, switchShop, isLoading } =
        useShopeeAuth();
    const [open, setOpen] = useState(false);

    const currentShop =
        shops.find((s) => s.shop_id === selectedShopId) ||
        (token?.shop_id
            ? { shop_id: token.shop_id, shop_name: `Shop ${token.shop_id}`, region: "VN" }
            : null);

    if (!currentShop) return null;

    const handleSwitchShop = async (shopId: number) => {
        setOpen(false);
        if (shopId !== selectedShopId) {
            await switchShop(shopId);
            window.location.reload();
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                disabled={isLoading || shops.length <= 1}
                className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors",
                    shops.length > 1
                        ? "bg-orange-50 border-orange-200 hover:bg-orange-100 cursor-pointer"
                        : "bg-slate-50 border-slate-200 cursor-default"
                )}
            >
                <div className="w-6 h-6 bg-orange-100 rounded flex items-center justify-center">
                    <svg
                        className="w-4 h-4 text-orange-600"
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
                </div>
                <div className="text-left">
                    <p className="text-sm font-medium text-slate-700 max-w-[150px] truncate">
                        {currentShop.shop_name || `Shop ${currentShop.shop_id}`}
                    </p>
                </div>
                {shops.length > 1 && (
                    <svg
                        className={cn(
                            "w-4 h-4 text-slate-400 transition-transform",
                            open && "rotate-180"
                        )}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                        />
                    </svg>
                )}
            </button>

            {/* Dropdown */}
            {open && shops.length > 1 && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-20 max-h-80 overflow-auto">
                        <p className="px-3 py-1 text-xs text-slate-400 font-medium">
                            Chọn shop
                        </p>
                        {shops.map((shop) => (
                            <button
                                key={shop.shop_id}
                                onClick={() => handleSwitchShop(shop.shop_id)}
                                className={cn(
                                    "w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-3",
                                    shop.shop_id === selectedShopId && "bg-orange-50"
                                )}
                            >
                                <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <svg
                                        className="w-4 h-4 text-orange-600"
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
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-700 truncate">
                                        {shop.shop_name || `Shop ${shop.shop_id}`}
                                    </p>
                                    <p className="text-xs text-slate-400">ID: {shop.shop_id}</p>
                                </div>
                                {shop.shop_id === selectedShopId && (
                                    <svg
                                        className="w-4 h-4 text-orange-500"
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                    >
                                        <path
                                            fillRule="evenodd"
                                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                            clipRule="evenodd"
                                        />
                                    </svg>
                                )}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();

    // Auth states
    const {
        user,
        profile,
        isAuthenticated: isUserAuthenticated,
        isLoading: isUserLoading,
        signOut,
    } = useAuth();
    const { token, isLoading: isShopeeLoading, shops } = useShopeeAuth();

    // TODO: Implement proper role check when needed
    // sys_profiles không có role, cần check từ apishopee_shop_members
    const canManageUsers = true; // Tạm cho phép tất cả

    // Filter menu items based on role
    const allMenuItems = useMemo(() => {
        return menuItems.map((item) => {
            if (item.id === "profile" && item.children) {
                return {
                    ...item,
                    children: item.children.filter((child) => {
                        if (child.id === "profile-users" && !canManageUsers) {
                            return false;
                        }
                        return true;
                    }),
                };
            }
            return item;
        });
    }, [canManageUsers]);

    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [expandedMenus, setExpandedMenus] = useState<string[]>([
        "flash-sale",
        "ads",
    ]);

    const isShopConnected = !!token?.shop_id;

    // Get active menu from URL path
    const getActiveMenu = () => {
        const directMatch = allMenuItems.find((m) => m.path === pathname);
        if (directMatch) return directMatch.id;

        for (const item of allMenuItems) {
            if (item.children) {
                const childMatch = item.children.find((c) => c.path === pathname);
                if (childMatch) return childMatch.id;
            }
        }
        return "dashboard";
    };

    const activeMenu = getActiveMenu();

    const toggleSubmenu = (menuId: string) => {
        setExpandedMenus((prev) =>
            prev.includes(menuId)
                ? prev.filter((id) => id !== menuId)
                : [...prev, menuId]
        );
    };

    const handleNavigate = (path: string) => {
        router.push(path);
    };

    // Not authenticated - redirect to login
    // This useEffect MUST be before any early returns to maintain hooks order
    useEffect(() => {
        if (!isUserLoading && !isShopeeLoading && !isUserAuthenticated) {
            router.replace("/auth");
        }
    }, [isUserLoading, isShopeeLoading, isUserAuthenticated, router]);

    // Loading state
    if (isUserLoading || isShopeeLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-500">Đang kiểm tra đăng nhập...</p>
                </div>
            </div>
        );
    }

    if (!isUserAuthenticated) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-500">Đang chuyển hướng...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <aside
                    className={cn(
                        "bg-white border-r border-slate-200 flex flex-col transition-all duration-300 shadow-sm h-full",
                        sidebarCollapsed ? "w-16" : "w-64"
                    )}
                >
                    {/* Logo */}
                    <div className="h-16 flex items-center justify-between px-4 border-b border-slate-100">
                        {!sidebarCollapsed && (
                            <a
                                href="/"
                                className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
                            >
                                <img
                                    src="/logo_betacom.png"
                                    alt="BETACOM"
                                    className="w-8 h-8 rounded-lg object-contain"
                                />
                                <h1 className="font-bold text-xl text-red-500">BETACOM</h1>
                            </a>
                        )}
                        {sidebarCollapsed && (
                            <a
                                href="/"
                                className="hover:opacity-80 transition-opacity cursor-pointer"
                            >
                                <img
                                    src="/logo_betacom.png"
                                    alt="BETACOM"
                                    className="w-8 h-8 rounded-lg object-contain"
                                />
                            </a>
                        )}
                        <button
                            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <svg
                                className={cn(
                                    "w-4 h-4 text-slate-400 transition-transform",
                                    sidebarCollapsed && "rotate-180"
                                )}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                                />
                            </svg>
                        </button>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
                        {allMenuItems.map((item) => {
                            const isActive =
                                activeMenu === item.id ||
                                item.children?.some((c) => c.id === activeMenu);
                            const isExpanded = expandedMenus.includes(item.id);
                            const hasChildren = item.children && item.children.length > 0;

                            return (
                                <div key={item.id}>
                                    <button
                                        onClick={() => {
                                            if (hasChildren) {
                                                toggleSubmenu(item.id);
                                                if (!item.children?.some((c) => c.id === activeMenu)) {
                                                    handleNavigate(item.children![0].path);
                                                }
                                            } else {
                                                handleNavigate(item.path);
                                            }
                                        }}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group",
                                            isActive
                                                ? "bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/25"
                                                : "text-slate-600 hover:bg-slate-50",
                                            sidebarCollapsed && "justify-center px-2"
                                        )}
                                        title={sidebarCollapsed ? item.label : undefined}
                                    >
                                        <span
                                            className={cn(
                                                "transition-colors",
                                                isActive
                                                    ? "text-white"
                                                    : "text-slate-400 group-hover:text-orange-500"
                                            )}
                                        >
                                            {item.icon}
                                        </span>
                                        {!sidebarCollapsed && (
                                            <>
                                                <span className="font-medium text-sm flex-1 text-left">
                                                    {item.label}
                                                </span>
                                                {hasChildren && (
                                                    <svg
                                                        className={cn(
                                                            "w-4 h-4 transition-transform",
                                                            isExpanded && "rotate-180"
                                                        )}
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            strokeWidth={2}
                                                            d="M19 9l-7 7-7-7"
                                                        />
                                                    </svg>
                                                )}
                                            </>
                                        )}
                                    </button>

                                    {/* Submenu */}
                                    {hasChildren && isExpanded && !sidebarCollapsed && (
                                        <div className="ml-4 mt-1 space-y-1">
                                            {item.children!.map((child) => (
                                                <button
                                                    key={child.id}
                                                    onClick={() => handleNavigate(child.path)}
                                                    className={cn(
                                                        "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm",
                                                        activeMenu === child.id
                                                            ? "bg-orange-50 text-orange-600 font-medium"
                                                            : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            "w-4 h-4",
                                                            activeMenu === child.id
                                                                ? "text-orange-500"
                                                                : "text-slate-400"
                                                        )}
                                                    >
                                                        {child.icon}
                                                    </span>
                                                    <span>{child.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </nav>

                    {/* User Section */}
                    <div className="p-2 border-t border-slate-100">
                        <div className="relative">
                            <button
                                onClick={() => setShowUserMenu(!showUserMenu)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors",
                                    sidebarCollapsed && "justify-center"
                                )}
                            >
                                <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                                    {profile?.full_name?.[0]?.toUpperCase() ||
                                        user?.email?.[0]?.toUpperCase() ||
                                        "U"}
                                </div>
                                {!sidebarCollapsed && (
                                    <div className="flex-1 text-left">
                                        <p className="text-sm font-medium text-slate-700 truncate">
                                            {profile?.full_name || user?.email?.split("@")[0]}
                                        </p>
                                        <p className="text-xs text-slate-400 capitalize">
                                            {profile?.work_type === 'fulltime' ? 'Full-time' : 'Part-time'}
                                        </p>
                                    </div>
                                )}
                            </button>

                            {/* User Menu Dropdown */}
                            {showUserMenu && (
                                <>
                                    <div
                                        className="fixed inset-0 z-10"
                                        onClick={() => setShowUserMenu(false)}
                                    />
                                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-20">
                                        <button
                                            onClick={() => {
                                                setShowUserMenu(false);
                                                handleNavigate("/profile");
                                            }}
                                            className="w-full px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                                        >
                                            <UserIcon />
                                            Hồ sơ cá nhân
                                        </button>
                                        <hr className="my-1 border-slate-100" />
                                        <button
                                            onClick={() => {
                                                setShowUserMenu(false);
                                                signOut();
                                            }}
                                            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                        >
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
                                                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                                                />
                                            </svg>
                                            Đăng xuất
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 overflow-auto">
                    {/* Header */}
                    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-10">
                        <div>
                            <h2 className="font-semibold text-slate-800">
                                {allMenuItems.find((m) => m.id === activeMenu)?.label ||
                                    allMenuItems
                                        .flatMap((m) => m.children || [])
                                        .find((c) => c.id === activeMenu)?.label ||
                                    "Dashboard"}
                            </h2>
                        </div>
                        <div className="flex items-center gap-3">
                            {isShopConnected && <ShopSelector />}
                        </div>
                    </header>

                    {/* Page Content */}
                    <div className="h-[calc(100%-4rem)]">{children}</div>
                </main>
            </div>
        </div>
    );
}
