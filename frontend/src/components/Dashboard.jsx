import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Upload, Download, Activity, ChevronDown } from 'lucide-react';
import { SIGNAL_CONFIG, getSignalsByCategory } from '../signalConfig';
import Graph from './Graph';
import TraceWindow from './TraceWindow';

const Dashboard = ({ websocket, receivedSignals, rawMessages = [], unknownSignals = [] }) => {
  console.log('Dashboard render start');
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
  // Signals the user has manually locked/overridden while in TX mode
  const [manualOverride, setManualOverride] = useState(new Set());
  const timeRef = useRef(0);
  const animationRef = useRef(null);
  // Keep a ref copy so the animation loop always sees the latest locks without
  // re-creating the animation effect at every toggle.
  const manualOverrideRef = useRef(manualOverride);
  useEffect(() => { manualOverrideRef.current = manualOverride; }, [manualOverride]);

  const signalsByCategory = getSignalsByCategory();
  console.log('signalsByCategory', signalsByCategory);
  const [expandedCategories, setExpandedCategories] = useState(new Set(Object.keys(signalsByCategory)));
  // Multiple graph panes (each graph holds its own selected signals and chooser state)
  const [graphs, setGraphs] = useState([{ id: 1, signals: [], chooserOpen: false, chooserQuery: '' }]);
  const nextGraphId = useRef(2);
  const addGraph = () => setGraphs(prev => [...prev, { id: nextGraphId.current++, signals: [], chooserOpen: false, chooserQuery: '' }]);
  const removeGraph = (id) => setGraphs(prev => prev.filter(g => g.id !== id));

  const toggleChooser = (graphId) => {
    setGraphs(prev => prev.map(g => g.id === graphId ? { ...g, chooserOpen: !g.chooserOpen } : g));
  };

  const toggleGraphSignal = (graphId, signalName) => {
    setGraphs(prev => prev.map(g => {
      if (g.id !== graphId) return g;
      const s = new Set(g.signals || []);
      s.has(signalName) ? s.delete(signalName) : s.add(signalName);
      return { ...g, signals: [...s] };
    }));
  };

  const setChooserQuery = (graphId, q) => {
    setGraphs(prev => prev.map(g => g.id === graphId ? { ...g, chooserQuery: q } : g));
  };

  // Return JSX with the matched substring highlighted for the given query (case-insensitive)
  const highlightMatch = (text, q) => {
    if (!q) return text;
    const lower = text.toLowerCase();
    const needle = q.toLowerCase().trim();
    const idx = lower.indexOf(needle);
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + needle.length);
    const after = text.slice(idx + needle.length);
    return (
      <>
        {before}
        <span className="bg-yellow-400 text-black px-1 rounded">{match}</span>
        {after}
      </>
    );
  };

  const setGraphCategorySignals = (graphId, category, enable) => {
    const names = signalsByCategory[category] || [];
    setGraphs(prev => prev.map(g => {
      if (g.id !== graphId) return g;
      const s = new Set(g.signals || []);
      if (enable) names.forEach(n => s.add(n)); else names.forEach(n => s.delete(n));
      return { ...g, signals: [...s] };
    }));
  };

  const toggleManualOverride = (signalName) => {
    setManualOverride(prev => {
      const s = new Set(prev);
      if (s.has(signalName)) {
        s.delete(signalName);
      } else {
        s.add(signalName);
        // send the current value immediately when locking
        const val = signals[signalName];
        if (val !== undefined) sendSignalUpdate(signalName, val);
      }
      return s;
    });
  };

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
  const sendSignalUpdate = useCallback((signalName, value) => {
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
            // If user manually locked this signal, do not overwrite its value
            if (manualOverrideRef.current.has(name)) {
              // still send the manual value
              sendSignalUpdate(name, next[name]);
              return;
            }
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
                // if user has manual override, skip replay overwriting and instead send manual value
                if (manualOverrideRef.current.has(key)) {
                  sendSignalUpdate(key, nextSig[key]);
                  return;
                }
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

  // Manual override helpers: when running, user can enter a value and click Send to transmit once
  const handleManualInputChange = (signalName, value) => {
    const config = SIGNAL_CONFIG[signalName];
    const [, dataType, , min, max] = config;
    let parsed = dataType === 'bool' ? (value === '1' || value === 'true' ? 1 : 0) : parseFloat(value);
    if (dataType !== 'bool') parsed = isNaN(parsed) ? (signals[signalName] ?? min) : Math.max(min, Math.min(max, parsed));
    setSignals(prev => ({ ...prev, [signalName]: parsed }));
    if (manualOverride.has(signalName)) {
      sendSignalUpdate(signalName, parsed);
    }
  };

  // removed explicit Send button; manual locks will cause continuous transmission of the current value

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
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-8">
            <svg className="w-24 h-24" viewBox="0 0 2500 1100" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M1204.7,1006.34c442.1,70.2,887.04,55.56,1334.7,60.97-679.66,67.22-1732.39,61.06-2360.96-196.05C.58,812.36-2.79,588.73,170.53,525.08c132.04-58.4,277.85-71.77,420.1-82.5,109.31,4.7,221.52-7.99,330.35,6.18,50.89,9.31-19.53-59.21,9.69-100.31,142.78-197.86,620.69-115.45,766.59,54.73,76.71,73.33-35.5,136.69,37.83,140.61,248.67,46.07,499.24,95.1,740.63,172.12-573.69-81.83-1235.66-237.63-1847.19-138.01-137.95,19.32-283.5,150.22-105.59,245.45,207.59,112.58,452.28,139.12,681.57,182.97M1134.45,283.19c-71.21,14.48-196.79,80.48-148.51,161.4,58.19,19.24,125.24,14.54,187.5,23.14,166.4,15.24,333,46.55,498.07,63.53,99.31-208.31-396.81-290.43-536.88-248.11M686.88,894.01c.53.72,3,.72,3.48-.1.14-.84-3.82-.87-3.48.1Z" fill="#A90515" />
            </svg>
            BSR Electrical Testbench
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

        {/* Main Grid: left = controls/trace/graph, right = category cards */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(720px,2fr)_1fr] gap-6 items-start">
          {/* Left stack: TX controls, trace, graph */}
          <div className="space-y-6">
            {/* TX Control Panel (already rendered above) */}
            {/* Trace Window Section (moved here) */}
            <div className="mt-0">
              <TraceWindow rawMessages={rawMessages} unknownSignals={unknownSignals} />
            </div>

            {/* Graph */}
            {graphs.map(g => (
              <div key={g.id} className="bg-gray-900 rounded-lg p-8 shadow-xl border border-gray-800">
                <div className="flex items-start justify-between mb-2 gap-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleChooser(g.id)} className="px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700">Choose Signals ({(g.signals || []).length})</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => removeGraph(g.id)} className="px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700">Remove</button>
                  </div>
                </div>

                {/* Signal chooser panel (grouped by subsystem) */}
                {g.chooserOpen && (
                  <div className="mb-4 bg-gray-800 p-4 rounded max-h-80 overflow-y-auto border border-gray-700">
                    <div className="mb-3">
                      <input
                        type="search"
                        placeholder="Search signals..."
                        value={g.chooserQuery || ''}
                        onChange={(e) => setChooserQuery(g.id, e.target.value)}
                        className="w-full bg-gray-900 rounded px-3 py-2 border border-gray-700 text-sm mb-3"
                      />
                    </div>
                    {Object.entries(signalsByCategory).map(([category, names]) => {
                      const q = (g.chooserQuery || '').toLowerCase().trim();
                      const filtered = q ? names.filter(n => n.toLowerCase().includes(q)) : names;
                      if (filtered.length === 0) return null;
                      return (
                        <div key={category} className="mb-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-semibold" style={{ color: '#A90515' }}>{category}</div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => setGraphCategorySignals(g.id, category, true)} className="text-xs px-2 py-0.5 bg-gray-700 rounded hover:bg-gray-600">Select All</button>
                              <button onClick={() => setGraphCategorySignals(g.id, category, false)} className="text-xs px-2 py-0.5 bg-gray-700 rounded hover:bg-gray-600">Clear</button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {filtered.map(signalName => (
                              <label key={signalName} className="flex items-center gap-2 text-sm bg-gray-900 rounded px-2 py-1 border border-gray-700">
                                <input type="checkbox" checked={(g.signals || []).includes(signalName)} onChange={() => toggleGraphSignal(g.id, signalName)} className="w-4 h-4" />
                                <span className="truncate inline-block max-w-full">{highlightMatch(signalName, q)}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <Graph history={signalHistory} signals={(g.signals || [])} />
              </div>
            ))}

            <div className="mt-2">
              <button onClick={addGraph} className="px-3 py-2 bg-gray-800 rounded hover:bg-gray-700">Add Graph</button>
            </div>
          </div>

          {/* Right column: category cards */}
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
                          <div key={signalName} className={`bg-gray-800 rounded-lg p-4 border ${isTx ? 'border-red-900/40' : hasReceivedData ? 'border-green-500' : 'border-gray-700'}`}>
                            <div className="flex items-center gap-3">
                              <select
                                value={dir}
                                onChange={(e) => setDirection(signalName, e.target.value)}
                                className={`text-xs font-bold rounded px-2 py-1 border-0 cursor-pointer`}
                                style={{ backgroundColor: isTx ? '#A90515' : '#10b981', color: isTx ? 'white' : 'black' }}
                              >
                                <option value="rx" style={{ color: '#064e3b', backgroundColor: '#bbf7d0' }}>RX</option>
                                <option value="tx" style={{ color: '#ffffff', backgroundColor: '#A90515' }}>TX</option>
                              </select>

                              {/* Plot selection moved to per-graph chooser; removed global plot checkbox */}

                              <span className="font-medium flex-1">{signalName}</span>

                              {!isTx && canId && (
                                <span className="text-xs text-gray-500">0x{canId.toString(16).toUpperCase()}</span>
                              )}

                              <span className="text-lg font-mono tabular-nums" style={{ color: hasReceivedData ? '#10b981' : isTx ? '#f87171' : 'rgba(255,255,255,0.87)' }}>
                                {dataType === 'bool' ? (value ? 'TRUE' : 'FALSE') : typeof value === 'number' ? value.toFixed(2) : '\u2014'}{' '}
                                <span className="text-xs text-gray-400">{units}</span>
                              </span>
                            </div>

                            {!isTx && timestamp && (
                              <div className="text-[10px] text-gray-500 mt-1 pl-28">
                                {new Date(timestamp * 1000).toLocaleTimeString()}
                              </div>
                            )}

                            {isTx && (
                              <div className="mt-3 flex gap-2 items-center">
                                {dataType === 'bool' ? (
                                  <>
                                    <select value={signals[signalName] ?? value} onChange={(e) => {
                                      if (!isRunning) updateManualValue(signalName, e.target.value);
                                      else handleManualInputChange(signalName, e.target.value);
                                    }} className="bg-gray-700 rounded px-3 py-2 border border-gray-600 text-sm">
                                      <option value="0">FALSE</option>
                                      <option value="1">TRUE</option>
                                    </select>
                                    <div className="flex items-center gap-2">
                                      <button onClick={() => toggleManualOverride(signalName)} className={`px-2 py-1 text-xs rounded ${manualOverride.has(signalName) ? 'bg-yellow-600 text-black' : 'bg-gray-800 hover:bg-gray-700'}`}>
                                        {manualOverride.has(signalName) ? 'Locked' : 'Manual'}
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <input type="number" step="0.01" min={min} max={max} value={signals[signalName] ?? value} onChange={(e) => {
                                      if (!isRunning) updateManualValue(signalName, e.target.value);
                                      else handleManualInputChange(signalName, e.target.value);
                                    }} className="w-full bg-gray-700 rounded px-3 py-2 border border-gray-600 text-sm" />
                                    <div className="flex items-center gap-2">
                                      <button onClick={() => toggleManualOverride(signalName)} className={`px-2 py-1 text-xs rounded ${manualOverride.has(signalName) ? 'bg-yellow-600 text-black' : 'bg-gray-800 hover:bg-gray-700'}`}>
                                        {manualOverride.has(signalName) ? 'Locked' : 'Manual'}
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}

                            {isTx && isRunning && mode === 'random' && dataType !== 'bool' && (
                              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                <div>
                                  <label className="text-gray-400 text-xs">Freq (Hz)</label>
                                  <input type="number" step="0.1" value={waveConfig[signalName]?.frequency || 0.5} onChange={(e) => updateWaveConfig(signalName, 'frequency', e.target.value)} className="w-full bg-gray-700 rounded px-2 py-1 mt-1 border border-gray-600" />
                                </div>
                                <div>
                                  <label className="text-gray-400 text-xs">Phase</label>
                                  <input type="number" step="0.1" value={waveConfig[signalName]?.phase || 0} onChange={(e) => updateWaveConfig(signalName, 'phase', e.target.value)} className="w-full bg-gray-700 rounded px-2 py-1 mt-1 border border-gray-600" />
                                </div>
                              </div>
                            )}

                            {dataType !== 'bool' && (
                              <div className="mt-2">
                                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                  <div className="h-full transition-all duration-200" style={{ backgroundColor: isTx ? '#A90515' : hasReceivedData ? '#10b981' : '#4b5563', width: `${typeof value === 'number' ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0}%` }} />
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
        </div>

      </div>
    </div>
  );
};

export default Dashboard;
