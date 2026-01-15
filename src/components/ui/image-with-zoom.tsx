/**
 * ImageWithZoom - Component hiển thị ảnh với zoom khi hover
 * Dùng chung cho tất cả các trang có hiển thị ảnh sản phẩm
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ImageWithZoomProps {
  src: string;
  alt: string;
  className?: string;
  zoomSize?: number;
  zoomPosition?: 'left' | 'right' | 'top' | 'bottom';
}

export function ImageWithZoom({
  src,
  alt,
  className,
  zoomSize = 280,
  zoomPosition = 'right',
}: ImageWithZoomProps) {
  const [showZoom, setShowZoom] = useState(false);

  const getZoomPositionStyles = () => {
    switch (zoomPosition) {
      case 'left':
        return 'right-full mr-2 top-0';
      case 'top':
        return 'bottom-full mb-2 left-0';
      case 'bottom':
        return 'top-full mt-2 left-0';
      case 'right':
      default:
        return 'left-full ml-2 top-0';
    }
  };

  return (
    <div className="relative">
      <img
        src={src}
        alt={alt}
        className={cn('cursor-pointer', className)}
        onMouseEnter={() => setShowZoom(true)}
        onMouseLeave={() => setShowZoom(false)}
      />
      {showZoom && (
        <div
          className={cn(
            'absolute z-50 bg-white rounded-lg shadow-xl border p-1',
            getZoomPositionStyles()
          )}
          style={{ width: zoomSize, height: zoomSize }}
        >
          <img
            src={src}
            alt={alt}
            className="w-full h-full object-contain rounded"
          />
        </div>
      )}
    </div>
  );
}

export default ImageWithZoom;
