import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Upload, Download, Activity, ChevronDown } from 'lucide-react';
import { SIGNAL_CONFIG, getSignalsByCategory } from '../signalConfig';
import Graph from './Graph';

const Dashboard = ({ websocket, receivedSignals }) => {
  // TX generation mode: random wave or csv replay
  const [mode, setMode] = useState('random');
  const [isRunning, setIsRunning] = useState(false);

  // Per-signal direction: 'tx' or 'rx'. Default all to 'rx' (passive monitoring)
  const [signalDirection, setSignalDirection] = useState(() => {
    const init = {};
    Object.keys(SIGNAL_CONFIG).forEach(name => { init[name] = 'rx'; });
    return init;
  });

  // TX signal values (manual or generated)
  const [signals, setSignals] = useState({});
  // Plot checkboxes – works for any signal regardless of direction
  const [plotSignals, setPlotSignals] = useState(new Set());
  // History for graphing (both TX and RX)
  const [signalHistory, setSignalHistory] = useState({});

  const [replayData, setReplayData] = useState(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [waveConfig, setWaveConfig] = useState({});
  const timeRef = useRef(0);
  const animationRef = useRef(null);

  const signalsByCategory = getSignalsByCategory();
  const [expandedCategories, setExpandedCategories] = useState(new Set(Object.keys(signalsByCategory)));

  // Derived: set of signal names currently in TX mode
  const txSignals = new Set(
    Object.entries(signalDirection).filter(([, dir]) => dir === 'tx').map(([name]) => name)
  );

  // Initialize signals and wave configs
  useEffect(() => {
    const initialSignals = {};
    const initialWaveConfig = {};

    Object.entries(SIGNAL_CONFIG).forEach(([name, config]) => {
      const [, dataType, , min, max] = config;
      const midpoint = dataType === 'bool' ? 0 : (min + max) / 2;
      initialSignals[name] = midpoint;
      initialWaveConfig[name] = {
        frequency: 0.5,
        amplitude: (max - min) / 2,
        offset: midpoint,
        phase: 0,
      };
    });

    setSignals(initialSignals);
    setWaveConfig(initialWaveConfig);
  }, []);

  // Send a signal update to the backend via WebSocket
  const sendSignalUpdate = React.useCallback((signalName, value) => {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: 'signal_update',
        signal_name: signalName,
        value: value,
      });
      websocket.send(message);
    }
  }, [websocket]);

  // ── Category helpers ────────────────────────────────────────
  const toggleExpand = (category) => {
    setExpandedCategories(prev => {
      const s = new Set(prev);
      s.has(category) ? s.delete(category) : s.add(category);
      return s;
    });
  };

  const setCategoryDirection = (category, dir) => {
    const names = signalsByCategory[category];
    setSignalDirection(prev => {
      const next = { ...prev };
      names.forEach(n => { next[n] = dir; });
      return next;
    });
  };

  // ── TX animation loop ──────────────────────────────────────
  useEffect(() => {
    if (!isRunning) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    const animate = () => {
      if (mode === 'random') {
        timeRef.current += 0.016; // ~60 fps

        setSignals(prev => {
          const next = { ...prev };
          txSignals.forEach(name => {
            const config = SIGNAL_CONFIG[name];
            if (!config) return;
            const [, dataType, , min, max] = config;
            const wave = waveConfig[name];
            if (!wave) return;

            let newVal;
            if (dataType === 'bool') {
              newVal = Math.sin(2 * Math.PI * wave.frequency * timeRef.current + wave.phase) > 0 ? 1 : 0;
            } else {
              const raw = wave.offset + wave.amplitude * Math.sin(2 * Math.PI * wave.frequency * timeRef.current + wave.phase);
              newVal = Math.max(min, Math.min(max, raw));
            }
            next[name] = newVal;
            sendSignalUpdate(name, newVal);
          });
          return next;
        });
      } else if (mode === 'replay' && replayData) {
        setReplayIndex(prev => {
          const nextIdx = (prev + 1) % replayData.length;
          const row = replayData[nextIdx];

          setSignals(prevSig => {
            const nextSig = { ...prevSig };
            txSignals.forEach(key => {
              if (row[key] !== undefined) {
                const v = parseFloat(row[key]);
                if (!isNaN(v)) {
                  nextSig[key] = v;
                  sendSignalUpdate(key, v);
                }
              }
            });
            return nextSig;
          });

          return nextIdx;
        });
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, mode, signalDirection, waveConfig, replayData, sendSignalUpdate]);

  // ── Record history for TX signals being generated ──────────
  useEffect(() => {
    if (!isRunning) return;
    const now = Date.now() / 1000;
    setSignalHistory(prev => {
      const next = { ...prev };
      txSignals.forEach(name => {
        const val = signals[name];
        if (val === undefined) return;
        const arr = next[name] ? [...next[name]] : [];
        arr.push({ timestamp: now, value: val });
        if (arr.length > 500) arr.shift();
        next[name] = arr;
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals]);

  // ── Record history for RX signals from the bus ─────────────
  useEffect(() => {
    Object.entries(receivedSignals || {}).forEach(([name, data]) => {
      if (signalDirection[name] !== 'rx') return;
      setSignalHistory(prev => {
        const arr = prev[name] ? [...prev[name]] : [];
        arr.push({ timestamp: data.timestamp || Date.now() / 1000, value: data.value });
        if (arr.length > 500) arr.shift();
        return { ...prev, [name]: arr };
      });
    });
  }, [receivedSignals, signalDirection]);

  // ── File upload / export ───────────────────────────────────
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      const data = lines.slice(1).map(line => {
        const values = line.split(',');
        const row = {};
        headers.forEach((header, i) => { row[header] = values[i]; });
        return row;
      });
      setReplayData(data);
      setReplayIndex(0);
      setMode('replay');
    };
    reader.readAsText(file);
  };

  const exportSignals = () => {
    const data = JSON.stringify(signals, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'signals-export.json';
    a.click();
  };

  // ── Per-signal helpers ─────────────────────────────────────
  const setDirection = (signalName, dir) => {
    setSignalDirection(prev => ({ ...prev, [signalName]: dir }));
  };

  const togglePlotSignal = (signalName) => {
    setPlotSignals(prev => {
      const s = new Set(prev);
      s.has(signalName) ? s.delete(signalName) : s.add(signalName);
      return s;
    });
  };

  const updateManualValue = (signalName, value) => {
    const config = SIGNAL_CONFIG[signalName];
    const [, dataType, , min, max] = config;
    let parsed = dataType === 'bool' ? (value === '1' || value === 'true' ? 1 : 0) : parseFloat(value);
    if (dataType !== 'bool') parsed = Math.max(min, Math.min(max, parsed));
    setSignals(prev => ({ ...prev, [signalName]: parsed }));
    sendSignalUpdate(signalName, parsed);
  };

  const updateWaveConfig = (signalName, param, value) => {
    setWaveConfig(prev => ({
      ...prev,
      [signalName]: { ...prev[signalName], [param]: parseFloat(value) },
    }));
  };

  // ── Render ─────────────────────────────────────────────────
  const txCount = txSignals.size;
  const rxCount = Object.keys(signalDirection).length - txCount;

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <Activity className="w-8 h-8" style={{ color: '#A90515' }} />
            Solar Car 2 Electrical Testbench
          </h1>
          <p className="text-gray-400">
            CAN Bus Monitor &amp; Injector &mdash;{' '}
            <span className="text-green-400">{rxCount} RX</span>
            <span className="mx-1">&middot;</span>
            <span style={{ color: '#A90515' }}>{txCount} TX</span>
            {isRunning && <span className="ml-2 text-yellow-400 animate-pulse">&#9679; TRANSMITTING</span>}
          </p>
        </div>

        {/* TX Control Panel */}
        <div className="bg-gray-900 rounded-lg p-6 mb-6 shadow-xl border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            TX Controls
            {txCount === 0 && <span className="ml-2 text-gray-500 normal-case">(set signals to TX to enable)</span>}
          </h2>

          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex gap-3">
              <button
                onClick={() => setMode('random')}
                disabled={txCount === 0}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  mode === 'random' ? 'text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                style={{ backgroundColor: mode === 'random' ? '#A90515' : undefined }}
              >
                Random Wave
              </button>
              <button
                onClick={() => setMode('replay')}
                disabled={txCount === 0}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  mode === 'replay' ? 'text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                style={{ backgroundColor: mode === 'replay' ? '#A90515' : undefined }}
              >
                CSV Replay
              </button>
            </div>

            <div className="flex gap-3">
              {mode === 'replay' && (
                <label className="px-4 py-2 bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600 transition flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  Upload CSV
                  <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                </label>
              )}

              <button
                onClick={() => setIsRunning(!isRunning)}
                disabled={txCount === 0}
                className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition ${
                  isRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {isRunning ? 'Stop' : 'Start'}
              </button>

              <button
                onClick={exportSignals}
                className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
          </div>

          {mode === 'replay' && replayData && (
            <div className="mt-4 text-sm text-gray-400">
              Replaying: Row {replayIndex + 1} of {replayData.length}
            </div>
          )}

          <div className="mt-3 text-xs text-gray-500">
            Listening for incoming CAN messages... Signals received: {Object.keys(receivedSignals || {}).length}
          </div>
        </div>

        {/* Main Grid: signal list + graph */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6 items-start">
          {/* Left column: category cards */}
          <div>
            {Object.entries(signalsByCategory).map(([category, signalNames]) => {
              const catTxCount = signalNames.filter(n => signalDirection[n] === 'tx').length;
              return (
                <div key={category} className="bg-gray-900 rounded-lg p-6 shadow-xl border border-gray-800 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold" style={{ color: '#A90515' }}>
                      {category}
                      <span className="ml-3 text-xs font-normal text-gray-400">
                        {catTxCount} TX &middot; {signalNames.length - catTxCount} RX
                      </span>
                    </h2>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCategoryDirection(category, 'tx')}
                        className="px-3 py-1 rounded text-sm transition hover:bg-gray-600"
                        style={{ backgroundColor: catTxCount === signalNames.length ? '#A90515' : undefined, color: catTxCount === signalNames.length ? 'white' : '#9ca3af' }}
                      >
                        All TX
                      </button>
                      <button
                        onClick={() => setCategoryDirection(category, 'rx')}
                        className="px-3 py-1 rounded text-sm transition hover:bg-gray-600"
                        style={{ backgroundColor: catTxCount === 0 ? '#10b981' : undefined, color: catTxCount === 0 ? 'white' : '#9ca3af' }}
                      >
                        All RX
                      </button>
                      <button
                        onClick={() => toggleExpand(category)}
                        className="text-white hover:text-gray-300 transition"
                      >
                        <ChevronDown className={`w-5 h-5 transform transition-transform ${expandedCategories.has(category) ? 'rotate-0' : '-rotate-90'}`} />
                      </button>
                    </div>
                  </div>

                  {expandedCategories.has(category) && (
                    <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                      {signalNames.map(signalName => {
                        const config = SIGNAL_CONFIG[signalName];
                        const [, dataType, units, min, max] = config;
                        const dir = signalDirection[signalName];
                        const isTx = dir === 'tx';

                        // Value source
                        let value, timestamp, canId;
                        if (isTx) {
                          value = signals[signalName] ?? 0;
                        } else {
                          const received = receivedSignals?.[signalName];
                          value = received?.value ?? 0;
                          timestamp = received?.timestamp;
                          canId = received?.can_id;
                        }
                        const hasReceivedData = !isTx && receivedSignals?.[signalName];
                        const isPlotted = plotSignals.has(signalName);

                        return (
                          <div
                            key={signalName}
                            className={`bg-gray-800 rounded-lg p-4 border ${
                              isTx ? 'border-red-900/40' : hasReceivedData ? 'border-green-500' : 'border-gray-700'
                            }`}
                          >
                            {/* Row 1: direction, name, plot, value */}
                            <div className="flex items-center gap-3">
                              {/* TX/RX selector */}
                              <select
                                value={dir}
                                onChange={(e) => setDirection(signalName, e.target.value)}
                                className={`text-xs font-bold rounded px-2 py-1 border-0 cursor-pointer ${
                                  isTx ? 'bg-red-900 text-red-200' : 'bg-green-900 text-green-200'
                                }`}
                              >
                                <option value="rx">RX</option>
                                <option value="tx">TX</option>
                              </select>

                              {/* Plot checkbox */}
                              <label className="flex items-center gap-1 cursor-pointer select-none" title="Plot on graph">
                                <input
                                  type="checkbox"
                                  checked={isPlotted}
                                  onChange={() => togglePlotSignal(signalName)}
                                  className="w-3.5 h-3.5 rounded accent-blue-500"
                                />
                                <span className="text-[10px] text-gray-500">plot</span>
                              </label>

                              {/* Signal name */}
                              <span className="font-medium flex-1">{signalName}</span>

                              {/* CAN ID for RX */}
                              {!isTx && canId && (
                                <span className="text-xs text-gray-500">0x{canId.toString(16).toUpperCase()}</span>
                              )}

                              {/* Value */}
                              <span
                                className="text-lg font-mono tabular-nums"
                                style={{ color: hasReceivedData ? '#10b981' : isTx ? '#f87171' : 'rgba(255,255,255,0.87)' }}
                              >
                                {dataType === 'bool'
                                  ? (value ? 'TRUE' : 'FALSE')
                                  : typeof value === 'number' ? value.toFixed(2) : '\u2014'}{' '}
                                <span className="text-xs text-gray-400">{units}</span>
                              </span>
                            </div>

                            {/* Timestamp for RX */}
                            {!isTx && timestamp && (
                              <div className="text-[10px] text-gray-500 mt-1 pl-28">
                                {new Date(timestamp * 1000).toLocaleTimeString()}
                              </div>
                            )}

                            {/* TX: manual controls when TX generation is stopped */}
                            {isTx && !isRunning && (
                              <div className="mt-3">
                                {dataType === 'bool' ? (
                                  <select
                                    value={value}
                                    onChange={(e) => updateManualValue(signalName, e.target.value)}
                                    className="w-full bg-gray-700 rounded px-3 py-2 border border-gray-600 text-sm"
                                  >
                                    <option value="0">FALSE</option>
                                    <option value="1">TRUE</option>
                                  </select>
                                ) : (
                                  <input
                                    type="number"
                                    step="0.01"
                                    min={min}
                                    max={max}
                                    value={value}
                                    onChange={(e) => updateManualValue(signalName, e.target.value)}
                                    className="w-full bg-gray-700 rounded px-3 py-2 border border-gray-600 text-sm"
                                  />
                                )}
                              </div>
                            )}

                            {/* TX: wave config when running in random mode */}
                            {isTx && isRunning && mode === 'random' && dataType !== 'bool' && (
                              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                <div>
                                  <label className="text-gray-400 text-xs">Freq (Hz)</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={waveConfig[signalName]?.frequency || 0.5}
                                    onChange={(e) => updateWaveConfig(signalName, 'frequency', e.target.value)}
                                    className="w-full bg-gray-700 rounded px-2 py-1 mt-1 border border-gray-600"
                                  />
                                </div>
                                <div>
                                  <label className="text-gray-400 text-xs">Phase</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={waveConfig[signalName]?.phase || 0}
                                    onChange={(e) => updateWaveConfig(signalName, 'phase', e.target.value)}
                                    className="w-full bg-gray-700 rounded px-2 py-1 mt-1 border border-gray-600"
                                  />
                                </div>
                              </div>
                            )}

                            {/* Progress bar for numeric signals */}
                            {dataType !== 'bool' && (
                              <div className="mt-2">
                                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full transition-all duration-200"
                                    style={{
                                      backgroundColor: isTx ? '#A90515' : hasReceivedData ? '#10b981' : '#4b5563',
                                      width: `${typeof value === 'number' ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0}%`,
                                    }}
                                  />
                                </div>
                                <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                                  <span>{min}</span>
                                  <span>{max}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right column: always-visible graph */}
          <div className="sticky top-6">
            <Graph history={signalHistory} signals={[...plotSignals]} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
