import Link from "next/link";

export default function NotFound() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="text-center">
                <h1 className="text-6xl font-bold text-slate-800 mb-4">404</h1>
                <p className="text-xl text-slate-600 mb-8">Trang không tồn tại</p>
                <Link
                    href="/dashboard"
                    className="px-6 py-3 bg-orange-500 text-white font-medium rounded-xl hover:bg-orange-600 transition-colors"
                >
                    Quay về trang chủ
                </Link>
            </div>
        </div>
    );
}
