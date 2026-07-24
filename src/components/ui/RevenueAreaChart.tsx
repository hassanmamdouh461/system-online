import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ChartDataPoint {
  label: string;
  value: number;
  orders?: number;
}

interface RevenueAreaChartProps {
  data: ChartDataPoint[];
  currencyStr?: string;
  isRtl?: boolean;
  ordersText?: string;
  height?: number;
}

// ─── Fritsch-Carlson Monotone Cubic Spline Generator ────────────────────────
function generateSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;
  }

  const n = points.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    dy[i] = points[i + 1].y - points[i].y;
    m[i] = dy[i] / (dx[i] || 1);
  }

  const tangents: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      tangents.push(0);
    } else {
      tangents.push((m[i - 1] + m[i]) / 2);
    }
  }
  tangents.push(m[n - 2]);

  let path = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;

  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const h = dx[i];

    const cp1x = p1.x + h / 3;
    const cp1y = p1.y + (tangents[i] * h) / 3;

    const cp2x = p2.x - h / 3;
    const cp2y = p2.y - (tangents[i + 1] * h) / 3;

    path += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }

  return path;
}

function generateAreaPath(points: { x: number; y: number }[], bottomY: number): string {
  if (points.length === 0) return '';
  const linePath = generateSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x.toFixed(2)},${bottomY.toFixed(2)} L ${first.x.toFixed(2)},${bottomY.toFixed(2)} Z`;
}

export function RevenueAreaChart({
  data,
  currencyStr = 'ج.م',
  isRtl = true,
  ordersText = 'طلبات',
  height = 280,
}: RevenueAreaChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return <div className="h-48 flex items-center justify-center text-gray-400 text-sm">لا توجد بيانات للعرض</div>;
  }

  // Dimensions
  const viewWidth = 800;
  const viewHeight = 250;
  const paddingLeft = 30;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 45;

  const innerWidth = viewWidth - paddingLeft - paddingRight;
  const innerHeight = viewHeight - paddingTop - paddingBottom;
  const bottomY = paddingTop + innerHeight;

  // Max value calculation
  const maxValue = Math.max(...data.map(d => d.value), 1);

  // Map data to SVG points
  const points = data.map((d, i) => {
    const x = paddingLeft + (data.length > 1 ? (i / (data.length - 1)) * innerWidth : innerWidth / 2);
    const normalizedVal = d.value / maxValue;
    const y = paddingTop + innerHeight - normalizedVal * (innerHeight * 0.85);
    return { x, y, raw: d };
  });

  const linePathD = generateSmoothPath(points);
  const areaPathD = generateAreaPath(points, bottomY);

  // Gridlines (5 horizontal lines)
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
    return paddingTop + innerHeight * (1 - ratio * 0.85);
  });

  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <div className="relative w-full select-none" style={{ minHeight: `${height}px` }}>
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        className="w-full h-full overflow-visible"
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          {/* Horizontal multi-color gradient for line stroke matching design image */}
          <linearGradient id="revenueLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d97706" />
            <stop offset="35%" stopColor="#cca045" />
            <stop offset="70%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>

          {/* Area fill gradient fading vertically and horizontally */}
          <linearGradient id="revenueAreaGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d97706" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#0284c7" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
          </linearGradient>

          {/* Glow filter for hover point */}
          <filter id="pointGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Horizontal Background Grid Lines */}
        {gridLines.map((y, idx) => (
          <line
            key={idx}
            x1={paddingLeft}
            y1={y}
            x2={viewWidth - paddingRight}
            y2={y}
            stroke="#f1f5f9"
            strokeWidth="1.2"
            strokeDasharray={idx === 0 || idx === gridLines.length - 1 ? 'none' : '4 4'}
          />
        ))}

        {/* Gradient Area Fill */}
        <motion.path
          key={`area-${data.length}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          d={areaPathD}
          fill="url(#revenueAreaGradient)"
        />

        {/* Curved Spline Line */}
        <motion.path
          key={`line-${data.length}`}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          d={linePathD}
          fill="none"
          stroke="url(#revenueLineGradient)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hover Guideline (Vertical Line) */}
        {activePoint && (
          <line
            x1={activePoint.x}
            y1={paddingTop}
            x2={activePoint.x}
            y2={bottomY}
            stroke="#94a3b8"
            strokeWidth="1"
            strokeDasharray="3 3"
            className="transition-all duration-150"
          />
        )}

        {/* Points / Circles along the curve */}
        {points.map((pt, idx) => {
          const isHovered = hoveredIdx === idx;
          // Determine color based on position ratio along gradient
          const ratio = points.length > 1 ? idx / (points.length - 1) : 0.5;
          const pointColor = ratio < 0.5 ? '#d97706' : ratio < 0.8 ? '#0284c7' : '#2563eb';

          return (
            <g
              key={idx}
              className="cursor-pointer group"
              onMouseEnter={() => setHoveredIdx(idx)}
            >
              {/* Invisible larger hit target for easy hovering */}
              <circle cx={pt.x} cy={pt.y} r="14" fill="transparent" />

              {/* Point Circle */}
              <motion.circle
                cx={pt.x}
                cy={pt.y}
                r={isHovered ? 6.5 : 4.5}
                fill="#ffffff"
                stroke={pointColor}
                strokeWidth={isHovered ? 3.5 : 2.5}
                filter={isHovered ? 'url(#pointGlow)' : undefined}
                className="transition-all duration-200"
              />
            </g>
          );
        })}

        {/* X-Axis Labels */}
        {points.map((pt, idx) => (
          <text
            key={idx}
            x={pt.x}
            y={viewHeight - 12}
            textAnchor="middle"
            fontSize="11"
            fontWeight={hoveredIdx === idx ? '700' : '600'}
            fill={hoveredIdx === idx ? '#0f172a' : '#64748b'}
            className="transition-colors duration-150"
          >
            {pt.raw.label}
          </text>
        ))}
      </svg>

      {/* Floating Interactive Tooltip */}
      <AnimatePresence>
        {activePoint && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute pointer-events-none z-50 transform -translate-x-1/2 -translate-y-full mb-3 bg-gray-900/95 backdrop-blur-md text-white px-3 py-2 rounded-xl shadow-xl text-center border border-gray-700/50"
            style={{
              left: `${(activePoint.x / viewWidth) * 100}%`,
              top: `${(activePoint.y / viewHeight) * 100}%`,
            }}
          >
            <div className="text-[10px] text-gray-400 font-semibold mb-0.5">{activePoint.raw.label}</div>
            <div className="text-xs font-bold text-amber-300 whitespace-nowrap">
              {activePoint.raw.value.toFixed(2)} {currencyStr}
            </div>
            {typeof activePoint.raw.orders === 'number' && activePoint.raw.orders > 0 && (
              <div className="text-[10px] text-sky-300 font-medium">
                {activePoint.raw.orders} {ordersText}
              </div>
            )}
            {/* Arrow pointer */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900/95" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
