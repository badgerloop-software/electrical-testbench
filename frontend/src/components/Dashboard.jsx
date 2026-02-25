import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Upload, Download, Activity, Send, Radio, ChevronDown } from 'lucide-react';
import { SIGNAL_CONFIG, getSignalsByCategory } from '../signalConfig';

const Dashboard = ({ websocket, receivedSignals }) => {
  const [dashboardMode, setDashboardMode] = useState('send'); // 'send' or 'read'
  const [mode, setMode] = useState('random'); // random, replay, or manual (only for send mode)
  const [isRunning, setIsRunning] = useState(false);
  const [signals, setSignals] = useState({});
  const [selectedSignals, setSelectedSignals] = useState(new Set(Object.keys(SIGNAL_CONFIG).slice(0, 6)));
  const [replayData, setReplayData] = useState(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [waveConfig, setWaveConfig] = useState({});
  const timeRef = useRef(0);
  const animationRef = useRef(null);
  const signalsByCategory = getSignalsByCategory();
  const [expandedCategories, setExpandedCategories] = useState(new Set(Object.keys(signalsByCategory)));

  // Initialize signals and wave configs
  useEffect(() => {
    const initialSignals = {};
    const initialWaveConfig = {};
    
    Object.entries(SIGNAL_CONFIG).forEach(([name, config]) => {
      const [_, dataType, __, min, max] = config;
      const midpoint = dataType === 'bool' ? 0 : (min + max) / 2;
      initialSignals[name] = midpoint;
      initialWaveConfig[name] = {
        frequency: 0.5,
        amplitude: (max - min) / 2,
        offset: midpoint,
        phase: 0
      };
    });
    
    setSignals(initialSignals);
    setWaveConfig(initialWaveConfig);
  }, []);

  // Send signal updates to backend via WebSocket
  const sendSignalUpdate = (signalName, value) => {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: 'signal_update',
        signal_name: signalName,
        value: value
      });
      websocket.send(message);
      console.log('Sent signal update:', signalName, value);
    }
  };

  // Toggle category expansion
  const toggleExpand = (category) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  // Select all signals in a category
  const selectAll = (category) => {
    const signalNames = signalsByCategory[category];
    setSelectedSignals(prev => new Set([...prev, ...signalNames]));
  };

  // Deselect all signals in a category
  const deselectAll = (category) => {
    const signalNames = signalsByCategory[category];
    setSelectedSignals(prev => new Set([...prev].filter(s => !signalNames.includes(s))));
  };

  // Animation loop for random mode
  useEffect(() => {
    if (!isRunning) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    const animate = () => {
      if (mode === 'random') {
        timeRef.current += 0.016; // ~60fps
        
        setSignals(prev => {
          const newSignals = { ...prev };
          selectedSignals.forEach(name => {
            const config = SIGNAL_CONFIG[name];
            const [_, dataType, __, min, max] = config;
            const wave = waveConfig[name];
            
            if (dataType === 'bool') {
              const newValue = Math.sin(2 * Math.PI * wave.frequency * timeRef.current + wave.phase) > 0 ? 1 : 0;
              newSignals[name] = newValue;
              sendSignalUpdate(name, newValue);
            } else {
              const value = wave.offset + wave.amplitude * Math.sin(2 * Math.PI * wave.frequency * timeRef.current + wave.phase);
              const clampedValue = Math.max(min, Math.min(max, value));
              newSignals[name] = clampedValue;
              sendSignalUpdate(name, clampedValue);
            }
          });
          return newSignals;
        });
      } else if (mode === 'replay' && replayData) {
        setReplayIndex(prev => {
          const next = (prev + 1) % replayData.length;
          const row = replayData[next];
          
          setSignals(prevSignals => {
            const newSignals = { ...prevSignals };
            selectedSignals.forEach(key => {
              if (row[key] !== undefined) {
                const value = parseFloat(row[key]);
                if (!isNaN(value)) {
                  newSignals[key] = value;
                  sendSignalUpdate(key, value);
                }
              }
            });
            return newSignals;
          });
          
          return next;
        });
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isRunning, mode, selectedSignals, waveConfig, replayData, websocket]);

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
        headers.forEach((header, i) => {
          row[header] = values[i];
        });
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

  const toggleSignal = (signalName) => {
    setSelectedSignals(prev => {
      const newSet = new Set(prev);
      if (newSet.has(signalName)) {
        newSet.delete(signalName);
      } else {
        newSet.add(signalName);
      }
      return newSet;
    });
  };

  const updateManualValue = (signalName, value) => {
    const config = SIGNAL_CONFIG[signalName];
    const [_, dataType, __, min, max] = config;
    
    let parsedValue = dataType === 'bool' ? (value === '1' || value === 'true' ? 1 : 0) : parseFloat(value);
    if (dataType !== 'bool') {
      parsedValue = Math.max(min, Math.min(max, parsedValue));
    }
    
    setSignals(prev => ({ ...prev, [signalName]: parsedValue }));
    sendSignalUpdate(signalName, parsedValue);
  };

  const updateWaveConfig = (signalName, param, value) => {
    setWaveConfig(prev => ({
      ...prev,
      [signalName]: {
        ...prev[signalName],
        [param]: parseFloat(value)
      }
    }));
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <Activity className="w-8 h-8" style={{ color: '#A90515' }} />
            Solar Car 2 Electrical Testbench
          </h1>
          <p className="text-gray-400">
            {dashboardMode === 'send' ? 'Send and Receive CAN Signals' : 'Monitor incoming CAN signals'}
          </p>
        </div>

        {/* Control Panel */}
        <div className="bg-gray-900 rounded-lg p-6 mb-6 shadow-xl border border-gray-800">
          {/* Send/Read Toggle */}
          <div className="flex gap-3 mb-6 pb-6 border-b border-gray-800">
            <button
              onClick={() => {
                setDashboardMode('send');
                setIsRunning(false);
              }}
              className={`px-6 py-3 rounded-lg font-medium transition flex items-center gap-2 ${
                dashboardMode === 'send' ? 'text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              style={{ backgroundColor: dashboardMode === 'send' ? '#A90515' : undefined }}
            >
              <Send className="w-5 h-5" />
              Send Mode
            </button>
            <button
              onClick={() => {
                setDashboardMode('read');
                setIsRunning(false);
              }}
              className={`px-6 py-3 rounded-lg font-medium transition flex items-center gap-2 ${
                dashboardMode === 'read' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <Radio className="w-5 h-5" />
              Read Mode
            </button>
          </div>

          {/* Send Mode Controls */}
          {dashboardMode === 'send' && (
            <>
              <div className="flex flex-wrap gap-4 items-center justify-between">
                <div className="flex gap-3">
                  <button
                    onClick={() => setMode('random')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${
                      mode === 'random' ? 'text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    style={{ backgroundColor: mode === 'random' ? '#A90515' : undefined }}
                  >
                    Random Wave
                  </button>
                  <button
                    onClick={() => setMode('replay')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${
                      mode === 'replay' ? 'text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
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
                    className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition ${
                      isRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                    }`}
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
            </>
          )}

          {/* Read Mode Info */}
          {dashboardMode === 'read' && (
            <div className="text-gray-400">
              <p className="text-sm">Listening for incoming CAN messages...</p>
              <p className="text-xs mt-2">Signals received: {Object.keys(receivedSignals || {}).length}</p>
            </div>
          )}
        </div>

        {/* Signal Display */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {Object.entries(signalsByCategory).map(([category, signalNames]) => (
            <div key={category} className="bg-gray-900 rounded-lg p-6 shadow-xl border border-gray-800">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold" style={{ color: '#A90515' }}>{category}</h2>
                <div className="flex items-center gap-2">
                  {dashboardMode === 'send' && (
                    <>
                      <button
                        onClick={() => selectAll(category)}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition"
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => deselectAll(category)}
                        className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 transition"
                      >
                        Deselect All
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => toggleExpand(category)}
                    className="text-white hover:text-gray-300 transition"
                  >
                    <ChevronDown className={`w-5 h-5 transform transition-transform ${expandedCategories.has(category) ? 'rotate-0' : '-rotate-90'}`} />
                  </button>
                </div>
              </div>
              
              {expandedCategories.has(category) && (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {signalNames.map(signalName => {
                  const config = SIGNAL_CONFIG[signalName];
                  const [_, dataType, units, min, max] = config;
                  
                  // Get value based on mode
                  let value, timestamp, canId;
                  if (dashboardMode === 'read') {
                    const received = receivedSignals?.[signalName];
                    value = received?.value ?? 0;
                    timestamp = received?.timestamp;
                    canId = received?.can_id;
                  } else {
                    value = signals[signalName] || 0;
                  }

                  const isSelected = selectedSignals.has(signalName);
                  const hasReceivedData = dashboardMode === 'read' && receivedSignals?.[signalName];

                  return (
                    <div key={signalName} className={`bg-gray-800 rounded-lg p-4 ${hasReceivedData ? 'ring-2 ring-green-500' : ''}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          {dashboardMode === 'send' && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSignal(signalName)}
                              className="w-4 h-4 rounded"
                            />
                          )}
                          <div>
                            <span className="font-medium">{signalName}</span>
                            {dashboardMode === 'send' && !isSelected && (
                              <span className="ml-2 text-xs text-yellow-400">(Manual Override)</span>
                            )}
                            {dashboardMode === 'read' && canId && (
                              <span className="ml-2 text-xs text-gray-500">ID: 0x{canId.toString(16)}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <span
                            className="text-lg font-mono"
                            style={{ color: hasReceivedData ? '#10b981' : 'rgba(255,255,255,0.87)' }}
                          >
                            {dataType === 'bool' ? (value ? 'TRUE' : 'FALSE') : 
                             typeof value === 'number' ? value.toFixed(2) : '—'} {units}
                          </span>
                          {dashboardMode === 'read' && timestamp && (
                            <div className="text-xs text-gray-500 mt-1">
                              {new Date(timestamp * 1000).toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Manual override always available when unchecked (Send mode only) */}
                      {dashboardMode === 'send' && !isSelected && (
                        <div className="mt-3">
                          {dataType === 'bool' ? (
                            <select
                              value={value}
                              onChange={(e) => updateManualValue(signalName, e.target.value)}
                              className="w-full bg-gray-700 rounded px-3 py-2 border border-gray-600"
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
                              className="w-full bg-gray-700 rounded px-3 py-2 border border-gray-600"
                            />
                          )}
                        </div>
                      )}

                      {/* Wave config only when checked and in random mode (Send mode only) */}
                      {dashboardMode === 'send' && isSelected && mode === 'random' && dataType !== 'bool' && (
                        <div className="mt-3 space-y-2 text-sm">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-gray-400">Frequency (Hz)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={waveConfig[signalName]?.frequency || 0.5}
                                onChange={(e) => updateWaveConfig(signalName, 'frequency', e.target.value)}
                                className="w-full bg-gray-700 rounded px-2 py-1 mt-1 border border-gray-600"
                              />
                            </div>
                            <div>
                              <label className="text-gray-400">Phase</label>
                              <input
                                type="number"
                                step="0.1"
                                value={waveConfig[signalName]?.phase || 0}
                                onChange={(e) => updateWaveConfig(signalName, 'phase', e.target.value)}
                                className="w-full bg-gray-700 rounded px-2 py-1 mt-1 border border-gray-600"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {dataType !== 'bool' && (
                        <div className="mt-2">
                          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full transition-all duration-200"
                              style={{ 
                                backgroundColor: hasReceivedData ? '#10b981' : '#A90515',
                                width: `${typeof value === 'number' ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0}%` 
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-gray-400 mt-1">
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
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
