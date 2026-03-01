import { useRef, useEffect, useState, useCallback } from 'react';
import { SIGNAL_CONFIG } from '../signalConfig';
import { Download, ZoomIn, ZoomOut, RotateCcw, Clock } from 'lucide-react';

const COLORS = ['#A90515', '#10b981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899'];

const Graph = ({ history, signals }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const [timeRange, setTimeRange] = useState('all'); // 'all', '10s', '30s', '1m', '5m'
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);

  // Margins for axes
  const margin = { top: 20, right: 60, bottom: 40, left: 60 };

  const exportData = useCallback(() => {
    if (signals.length === 0) return;

    const rows = [];
    const allTimestamps = new Set();

    // Collect all timestamps
    signals.forEach(name => {
      const arr = history[name] || [];
      arr.forEach(p => allTimestamps.add(p.timestamp));
    });

    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    // Build header
    const header = ['timestamp', ...signals];
    rows.push(header.join(','));

    // Build data rows
    sortedTimestamps.forEach(ts => {
      const row = [ts];
      signals.forEach(name => {
        const arr = history[name] || [];
        const point = arr.find(p => p.timestamp === ts);
        row.push(point ? point.value : '');
      });
      rows.push(row.join(','));
    });

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-data-${new Date().toISOString()}.csv`;
    a.click();
  }, [history, signals]);

  const exportImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `signal-graph-${new Date().toISOString()}.png`;
    link.href = canvas.toDataURL();
    link.click();
  }, []);

  const resetView = useCallback(() => {
    setZoomLevel(1);
    setPanOffset(0);
    setTimeRange('all');
  }, []);

  const handleZoomIn = () => setZoomLevel(z => Math.min(z * 1.5, 10));
  const handleZoomOut = () => setZoomLevel(z => Math.max(z / 1.5, 1));

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const delta = e.clientX - dragStart;
    setPanOffset(prev => prev - delta * 0.5);
    setDragStart(e.clientX);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    // Clear canvas
    ctx.fillStyle = '#1f2937'; // gray-800
    ctx.fillRect(0, 0, width, height);

    if (signals.length === 0) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Select signals to plot', width / 2, height / 2);
      return;
    }

    // Collect all points
    let allPoints = [];
    signals.forEach(name => {
      const arr = history[name] || [];
      allPoints = allPoints.concat(arr);
    });

    if (allPoints.length === 0) return;

    // Calculate time range
    let tMin = Math.min(...allPoints.map(p => p.timestamp));
    let tMax = Math.max(...allPoints.map(p => p.timestamp));

    // Apply time range filter
    const now = Date.now() / 1000;
    const timeRanges = {
      '10s': 10,
      '30s': 30,
      '1m': 60,
      '5m': 300,
    };

    if (timeRange !== 'all' && timeRanges[timeRange]) {
      const rangeStart = now - timeRanges[timeRange];
      if (rangeStart > tMin) {
        tMin = rangeStart;
      }
    }

    // Apply zoom and pan
    const timeSpan = tMax - tMin;
    const zoomedSpan = timeSpan / zoomLevel;
    const panTime = (panOffset / plotWidth) * timeSpan;
    tMin = tMin + panTime;
    tMax = tMin + zoomedSpan;

    // Clamp to data bounds
    const allTMin = Math.min(...allPoints.map(p => p.timestamp));
    const allTMax = Math.max(...allPoints.map(p => p.timestamp));
    if (tMin < allTMin) {
      tMin = allTMin;
      tMax = tMin + zoomedSpan;
    }
    if (tMax > allTMax) {
      tMax = allTMax;
      tMin = tMax - zoomedSpan;
    }

    // Determine unit groups
    const unitGroups = {};
    signals.forEach(name => {
      const config = SIGNAL_CONFIG[name] || [];
      const unit = config[2] || '';
      const min = config[3] ?? 0;
      const max = config[4] ?? 0;
      const grp = unitGroups[unit] || { min: Infinity, max: -Infinity };
      grp.min = Math.min(grp.min, min);
      grp.max = Math.max(grp.max, max);
      unitGroups[unit] = grp;
    });

    const unitList = Object.keys(unitGroups);

    // Helper functions
    const xFor = (t) => {
      if (tMax === tMin) return margin.left + plotWidth / 2;
      return margin.left + ((t - tMin) / (tMax - tMin)) * plotWidth;
    };

    const yScale = (v, unit) => {
      const { min, max } = unitGroups[unit];
      const norm = max === min ? 0.5 : (v - min) / (max - min);
      return margin.top + (1 - norm) * plotHeight;
    };

    // Draw grid
    ctx.strokeStyle = '#374151'; // gray-700
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = margin.top + (i / 4) * plotHeight;
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + plotWidth, y);
    }
    ctx.stroke();

    // Draw axes
    ctx.strokeStyle = '#9ca3af'; // gray-400
    ctx.lineWidth = 2;
    ctx.beginPath();
    // X axis
    ctx.moveTo(margin.left, margin.top + plotHeight);
    ctx.lineTo(margin.left + plotWidth, margin.top + plotHeight);
    // Left Y axis
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + plotHeight);
    // Right Y axis (if second unit)
    if (unitList.length > 1) {
      ctx.moveTo(margin.left + plotWidth, margin.top);
      ctx.lineTo(margin.left + plotWidth, margin.top + plotHeight);
    }
    ctx.stroke();

    // Draw X axis labels
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const xTicks = 5;
    for (let i = 0; i < xTicks; i++) {
      const t = tMin + (i / (xTicks - 1)) * (tMax - tMin);
      const x = xFor(t);
      const timeStr = new Date(t * 1000).toLocaleTimeString();
      ctx.fillText(timeStr, x, margin.top + plotHeight + 20);
    }

    // Draw Y axis labels
    ctx.textAlign = 'right';
    unitList.slice(0, 2).forEach((unit, ui) => {
      const { min, max } = unitGroups[unit];
      const xPos = ui === 0 ? margin.left - 10 : margin.left + plotWidth + 10;
      ctx.textAlign = ui === 0 ? 'right' : 'left';

      for (let i = 0; i <= 4; i++) {
        const val = min + (i / 4) * (max - min);
        const y = yScale(val, unit);
        ctx.fillText(val.toFixed(1) + (unit ? ' ' + unit : ''), xPos, y + 3);
      }
    });

    // Draw signal lines
    signals.forEach((name, idx) => {
      const arr = (history[name] || []).filter(p =>
        p.timestamp >= tMin && p.timestamp <= tMax
      );
      if (arr.length < 2) return;

      const config = SIGNAL_CONFIG[name] || [];
      const unit = config[2] || '';

      ctx.strokeStyle = COLORS[idx % COLORS.length];
      ctx.lineWidth = 2;
      ctx.beginPath();

      arr.forEach((p, i) => {
        const x = xFor(p.timestamp);
        const y = yScale(p.value, unit);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
    });
  }, [history, signals, zoomLevel, panOffset, timeRange]);

  // Handle time range change
  const handleTimeRangeChange = (range) => {
    setTimeRange(range);
    if (range !== 'all') {
      setZoomLevel(1);
      setPanOffset(0);
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4 shadow-xl border border-gray-800" ref={containerRef}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Signal Graph</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Time Range Selector */}
          <div className="flex items-center gap-1 bg-gray-800 rounded p-1">
            <Clock className="w-4 h-4 text-gray-400 ml-2" />
            {['all', '10s', '30s', '1m', '5m'].map(range => (
              <button
                key={range}
                onClick={() => handleTimeRangeChange(range)}
                className={`px-2 py-1 rounded text-xs ${
                  timeRange === range
                    ? 'bg-[#A90515] text-white'
                    : 'text-gray-400 hover:bg-gray-700'
                }`}
              >
                {range === 'all' ? 'All' : range}
              </button>
            ))}
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleZoomOut}
              className="p-1.5 bg-gray-800 rounded hover:bg-gray-700"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-400 px-2">{Math.round(zoomLevel * 100)}%</span>
            <button
              onClick={handleZoomIn}
              className="p-1.5 bg-gray-800 rounded hover:bg-gray-700"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={resetView}
              className="p-1.5 bg-gray-800 rounded hover:bg-gray-700"
              title="Reset view"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Export Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={exportData}
              disabled={signals.length === 0}
              className="px-3 py-1.5 bg-gray-800 rounded hover:bg-gray-700 text-sm disabled:opacity-50 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
            <button
              onClick={exportImage}
              disabled={signals.length === 0}
              className="px-3 py-1.5 bg-gray-800 rounded hover:bg-gray-700 text-sm disabled:opacity-50 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              PNG
            </button>
          </div>
        </div>
      </div>

      {signals.length === 0 && (
        <p className="text-gray-400 text-sm mb-2">Select one or more variables above to begin plotting</p>
      )}

      <canvas
        ref={canvasRef}
        width={1200}
        height={600}
        className="w-full h-[32rem] bg-gray-800 rounded cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Legend */}
      {signals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {signals.map((name, idx) => (
            <div key={name} className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
              <span>{name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Instructions */}
      {signals.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Tip: Drag to pan, use zoom buttons to zoom in/out
        </p>
      )}
    </div>
  );
};

export default Graph;