import React, { useRef, useEffect } from 'react';
import { SIGNAL_CONFIG } from '../signalConfig';

// simple colors to cycle through for multiple lines
const COLORS = ['#A90515', '#10b981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899'];

const Graph = ({ history, signals }) => {
  const svgRef = useRef(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const width = svg.clientWidth;
    const height = svg.clientHeight;

    // clear previous contents
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // collect all points for time domain
    let allPoints = [];
    signals.forEach(name => {
      const arr = history[name] || [];
      allPoints = allPoints.concat(arr);
    });
    if (allPoints.length === 0) return;

    const tmin = Math.min(...allPoints.map(p => p.timestamp));
    const tmax = Math.max(...allPoints.map(p => p.timestamp));

    // margins for axes
    const margin = { top: 20, right: 50, bottom: 30, left: 50 };
    const wPlot = width - margin.left - margin.right;
    const hPlot = height - margin.top - margin.bottom;

    // determine unit groups (min/max per unit)
    const unitGroups = {};
    signals.forEach(name => {
      const config = SIGNAL_CONFIG[name] || [];
      const unit = config[2] || '';
      const min = config[3] ?? 0;
      const max = config[4] ?? 0;
      const grp = unitGroups[unit] || { min: Infinity, max: -Infinity, color: null };
      grp.min = Math.min(grp.min, min);
      grp.max = Math.max(grp.max, max);
      if (grp.color === null) grp.color = COLORS[signals.indexOf(name) % COLORS.length];
      unitGroups[unit] = grp;
    });
    const unitList = Object.keys(unitGroups);

    // helper to map timestamp to x coordinate
    const xFor = (t) => {
      if (tmax === tmin) return margin.left + wPlot / 2;
      return margin.left + ((t - tmin) / (tmax - tmin)) * wPlot;
    };

    // prepare y scales per unit
    const yScale = {};
    unitList.forEach(u => {
      const { min, max } = unitGroups[u];
      yScale[u] = (v) => {
        const norm = max === min ? 0.5 : (v - min) / (max - min);
        return margin.top + (1 - norm) * hPlot;
      };
    });

    // draw axes lines and ticks
    const ns = 'http://www.w3.org/2000/svg';
    const axisColor = '#9ca3af';

    // x-axis
    const xAxis = document.createElementNS(ns, 'line');
    xAxis.setAttribute('x1', margin.left);
    xAxis.setAttribute('y1', margin.top + hPlot);
    xAxis.setAttribute('x2', margin.left + wPlot);
    xAxis.setAttribute('y2', margin.top + hPlot);
    xAxis.setAttribute('stroke', axisColor);
    svg.appendChild(xAxis);

    // x ticks: tmin, mid, tmax
    [tmin, (tmin + tmax) / 2, tmax].forEach(t => {
      const x = xFor(t);
      const tick = document.createElementNS(ns, 'line');
      tick.setAttribute('x1', x);
      tick.setAttribute('y1', margin.top + hPlot);
      tick.setAttribute('x2', x);
      tick.setAttribute('y2', margin.top + hPlot + 5);
      tick.setAttribute('stroke', axisColor);
      svg.appendChild(tick);
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', margin.top + hPlot + 15);
      label.setAttribute('fill', axisColor);
      label.setAttribute('font-size', '10');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = new Date(t * 1000).toLocaleTimeString();
      svg.appendChild(label);
    });

    // y-axes for up to two units
    unitList.slice(0, 2).forEach((u, ui) => {
      const xPos = ui === 0 ? margin.left : margin.left + wPlot;
      const grp = unitGroups[u];
      const axis = document.createElementNS(ns, 'line');
      axis.setAttribute('x1', xPos);
      axis.setAttribute('y1', margin.top);
      axis.setAttribute('x2', xPos);
      axis.setAttribute('y2', margin.top + hPlot);
      axis.setAttribute('stroke', axisColor);
      svg.appendChild(axis);

      // ticks (5)
      for (let i = 0; i <= 4; i++) {
        const val = grp.min + (i / 4) * (grp.max - grp.min);
        const y = yScale[u](val);
        const tick = document.createElementNS(ns, 'line');
        const tx1 = xPos;
        const tx2 = xPos + (ui === 0 ? -5 : 5);
        tick.setAttribute('x1', tx1);
        tick.setAttribute('y1', y);
        tick.setAttribute('x2', tx2);
        tick.setAttribute('y2', y);
        tick.setAttribute('stroke', axisColor);
        svg.appendChild(tick);
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', tx1 + (ui === 0 ? -8 : 8));
        label.setAttribute('y', y + 3);
        label.setAttribute('fill', axisColor);
        label.setAttribute('font-size', '10');
        label.setAttribute('text-anchor', ui === 0 ? 'end' : 'start');
        label.textContent = val.toFixed(2) + (u ? ' ' + u : '');
        svg.appendChild(label);
      }
    });

    // draw signal lines using unit-specific scale
    signals.forEach((name, idx) => {
      const arr = history[name] || [];
      if (arr.length < 2) return;
      const config = SIGNAL_CONFIG[name];
      const unit = config[2] || '';
      const min = config[3] ?? 0;
      const max = config[4] ?? 0;
      const points = arr.map(p => {
        const x = xFor(p.timestamp);
        const yVal = typeof p.value === 'number' ? p.value : 0;
        const y = yScale[unit](yVal);
        return `${x},${y}`;
      }).join(' ');
      const poly = document.createElementNS(ns, 'polyline');
      poly.setAttribute('points', points);
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', COLORS[idx % COLORS.length]);
      poly.setAttribute('stroke-width', '2');
      svg.appendChild(poly);
    });
  }, [history, signals]);

  return (
    <div className="bg-gray-900 rounded-lg p-4 shadow-xl border border-gray-800">
      <h2 className="text-xl font-semibold mb-2">Signal Graph</h2>
      {signals.length === 0 && (
        <p className="text-gray-400 text-sm mb-2">Select one or more variables above to begin plotting</p>
      )}
      <svg ref={svgRef} className="w-full h-96 bg-gray-800 rounded" />
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
    </div>
  );
};

export default Graph;
