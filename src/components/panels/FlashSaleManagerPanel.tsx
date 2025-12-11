/**
 * Flash Sale Manager Panel - Gộp Flash Sale và Lịch hẹn giờ
 */

import { useState } from 'react';
import FlashSalePanel from './FlashSalePanel';
import ScheduledPanel from './ScheduledPanel';
import { cn } from '@/lib/utils';

type TabId = 'flash-sales' | 'scheduled';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const tabs: Tab[] = [
  {
    id: 'flash-sales',
    label: 'Flash Sale',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: 'scheduled',
    label: 'Lịch hẹn giờ',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

export default function FlashSaleManagerPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('flash-sales');

  return (
    <div className="h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="bg-white border-b border-slate-200 px-4">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'flash-sales' && <FlashSalePanel />}
        {activeTab === 'scheduled' && <ScheduledPanel />}
      </div>
    </div>
  );
}
