"use client";

/**
 * Auth Page - Trang đăng nhập/đăng ký tài khoản
 * Tích hợp Shopee Open Platform API
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import Image from "next/image";

type AuthMode = "login" | "register";

// Feature list for e-commerce showcase
const FEATURES = [
    {
        icon: (
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
        ),
        title: "Flash Sale Manager",
        description: "Quản lý và hẹn giờ đăng ký Flash Sale tự động",
    },
    {
        icon: (
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
        ),
        title: "Ads Budget Scheduler",
        description: "Lên lịch thay đổi ngân sách quảng cáo",
    },
    {
        icon: (
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
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
            </svg>
        ),
        title: "Analytics Dashboard",
        description: "Theo dõi hiệu suất bán hàng real-time",
    },
];

export default function AuthPage() {
    const router = useRouter();
    const { isLoading, error, signIn, signUp, clearError, isAuthenticated } = useAuth();
    const [mode, setMode] = useState<AuthMode>("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [localError, setLocalError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    // Redirect if already authenticated - using useEffect to avoid setState during render
    useEffect(() => {
        if (isAuthenticated) {
            router.replace("/dashboard");
        }
    }, [isAuthenticated, router]);

    // Show loading or nothing while redirecting
    if (isAuthenticated) {
        return null;
    }

    const switchMode = (newMode: AuthMode) => {
        setMode(newMode);
        setEmail("");
        setPassword("");
        setFullName("");
        setConfirmPassword("");
        setLocalError("");
        setSuccessMessage("");
        clearError();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError("");
        setSuccessMessage("");

        if (!email || !password) {
            setLocalError("Vui lòng điền đầy đủ thông tin");
            return;
        }

        if (mode === "register") {
            if (password !== confirmPassword) {
                setLocalError("Mật khẩu xác nhận không khớp");
                return;
            }
            if (password.length < 6) {
                setLocalError("Mật khẩu phải có ít nhất 6 ký tự");
                return;
            }

            const result = await signUp(email, password, fullName);
            if (result.success) {
                if (result.needsConfirmation) {
                    setSuccessMessage(
                        "Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản."
                    );
                }
            }
        } else {
            await signIn(email, password);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50 flex">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-80 h-80 bg-orange-200 rounded-full opacity-20 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-red-200 rounded-full opacity-20 blur-3xl" />
            </div>

            {/* Left Side - Features Showcase (Hidden on mobile) */}
            <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center p-12">
                <div className="max-w-lg">
                    {/* Logo & Branding */}
                    <div className="flex items-center gap-3 mb-8">
                        <img
                            src="/logo_betacom.png"
                            alt="BETACOM"
                            className="w-12 h-12 rounded-xl object-contain"
                        />
                        <div>
                            <h1 className="text-2xl font-bold text-red-500">BETACOM</h1>
                        </div>
                    </div>

                    {/* Main Headline */}
                    <h2 className="text-4xl font-bold text-slate-800 mb-4">
                        Quản lý Shop
                        <span className="text-orange-500"> hiệu quả hơn</span>
                    </h2>
                    <p className="text-lg text-slate-600 mb-8">
                        Công cụ tự động hóa Flash Sale, quảng cáo và theo dõi hiệu suất bán
                        hàng tích hợp trực tiếp với Shopee Open Platform API.
                    </p>

                    {/* Features List */}
                    <div className="space-y-4">
                        {FEATURES.map((feature, index) => (
                            <div
                                key={index}
                                className="flex items-start gap-4 p-4 bg-white/60 rounded-xl border border-slate-100"
                            >
                                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600 flex-shrink-0">
                                    {feature.icon}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-800">
                                        {feature.title}
                                    </h3>
                                    <p className="text-sm text-slate-600">{feature.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* API Integration Badge */}
                    <div className="mt-8 flex items-center gap-3 p-4 bg-gradient-to-r from-orange-100 to-red-100 rounded-xl">
                        <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
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
                        <div>
                            <p className="font-medium text-slate-800">Shopee Open Platform</p>
                            <p className="text-sm text-slate-600">
                                Tích hợp API chính thức từ Shopee
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Side - Auth Form */}
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="relative w-full max-w-md">
                    {/* Mobile Logo (shown only on mobile) */}
                    <div className="text-center mb-8 lg:hidden">
                        <img
                            src="/logo_betacom.png"
                            alt="BETACOM"
                            className="w-20 h-20 rounded-2xl shadow-xl shadow-orange-500/30 mb-4 object-contain mx-auto"
                        />
                        <h1 className="text-3xl font-bold text-red-500">BETACOM</h1>
                    </div>

                    {/* Auth Card */}
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100">
                        {/* Tabs */}
                        <div className="flex mb-6 bg-slate-100 rounded-xl p-1">
                            <button
                                onClick={() => switchMode("login")}
                                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${mode === "login"
                                    ? "bg-white text-slate-800 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                                    }`}
                            >
                                Đăng nhập
                            </button>
                            <button
                                onClick={() => switchMode("register")}
                                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${mode === "register"
                                    ? "bg-white text-slate-800 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                                    }`}
                            >
                                Đăng ký
                            </button>
                        </div>

                        {/* Error/Success Messages */}
                        {(error || localError) && (
                            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm flex items-center gap-2">
                                <svg
                                    className="w-5 h-5 flex-shrink-0"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                </svg>
                                <span>{error || localError}</span>
                            </div>
                        )}

                        {successMessage && (
                            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm flex items-center gap-2">
                                <svg
                                    className="w-5 h-5 flex-shrink-0"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                </svg>
                                <span>{successMessage}</span>
                            </div>
                        )}

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {mode === "register" && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                        Họ và tên
                                    </label>
                                    <input
                                        type="text"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        placeholder="Nguyễn Văn A"
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="email@example.com"
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                    Mật khẩu
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                                    required
                                />
                            </div>

                            {mode === "register" && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                        Xác nhận mật khẩu
                                    </label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                                        required
                                    />
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full py-3.5 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-red-600 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 flex items-center justify-center gap-2"
                            >
                                {isLoading ? (
                                    <>
                                        <svg
                                            className="w-5 h-5 animate-spin"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                        >
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
                                        <span>Đang xử lý...</span>
                                    </>
                                ) : (
                                    <span>{mode === "login" ? "Đăng nhập" : "Đăng ký"}</span>
                                )}
                            </button>
                        </form>
                    </div>

                    {/* Footer */}
                    <div className="text-center mt-6">
                        <p className="text-xs text-slate-400">
                            Powered by{" "}
                            <span className="font-medium">Shopee Open Platform API</span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
