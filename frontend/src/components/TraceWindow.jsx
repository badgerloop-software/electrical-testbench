import { useState, useRef, useEffect } from 'react';
import { Pause, Play, Trash2, Filter, Download } from 'lucide-react';

const TraceWindow = ({ rawMessages, unknownSignals }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [filterId, setFilterId] = useState('');
  const [maxMessages, setMaxMessages] = useState(500);
  const scrollRef = useRef(null);
  const [displayedMessages, setDisplayedMessages] = useState([]);

  // Update displayed messages when new raw messages arrive
  useEffect(() => {
    if (isPaused) return;

    setDisplayedMessages(prev => {
      const combined = [...prev, ...rawMessages];
      // Keep only last maxMessages
      if (combined.length > maxMessages) {
        return combined.slice(-maxMessages);
      }
      return combined;
    });
  }, [rawMessages, isPaused, maxMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && !isPaused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayedMessages, isPaused]);

  const clearMessages = () => {
    setDisplayedMessages([]);
  };

  const exportMessages = () => {
    const csv = [
      'Timestamp,CAN_ID_Hex,CAN_ID_Dec,DLC,Data_Hex',
      ...displayedMessages.map(m =>
        `${m.timestamp},${m.can_id_hex},${m.can_id},${m.dlc},${m.data_hex}`
      )
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `can-trace-${new Date().toISOString()}.csv`;
    a.click();
  };

  const filteredMessages = filterId
    ? displayedMessages.filter(m =>
        m.can_id_hex.toLowerCase().includes(filterId.toLowerCase()) ||
        m.can_id.toString().includes(filterId)
      )
    : displayedMessages;

  const getMessageColor = (canId) => {
    // Color code by CAN ID range
    if (canId >= 0x100 && canId < 0x200) return '#10b981'; // Battery - Green
    if (canId >= 0x200 && canId < 0x300) return '#3B82F6'; // PDC - Blue
    if (canId >= 0x300 && canId < 0x400) return '#F59E0B'; // High Voltage/Steering - Yellow
    if (canId >= 0x400 && canId < 0x500) return '#8B5CF6'; // Solar - Purple
    if (canId >= 0x500 && canId < 0x600) return '#EC4899'; // Powertrain - Pink
    if (canId >= 0x700 && canId <= 0x7FF) return '#A90515'; // Diagnostic/FFF - BSR Red
    return '#9ca3af'; // Unknown - Gray
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4 shadow-xl border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">CAN Message Trace</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-3 py-1.5 rounded flex items-center gap-2 text-sm ${
              isPaused ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={clearMessages}
            className="px-3 py-1.5 rounded bg-red-900 hover:bg-red-800 flex items-center gap-2 text-sm"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
          <button
            onClick={exportMessages}
            disabled={displayedMessages.length === 0}
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Filter by CAN ID (hex or dec)..."
          value={filterId}
          onChange={(e) => setFilterId(e.target.value)}
          className="bg-gray-800 rounded px-3 py-1.5 text-sm border border-gray-700 flex-1"
        />
        <select
          value={maxMessages}
          onChange={(e) => setMaxMessages(parseInt(e.target.value))}
          className="bg-gray-800 rounded px-2 py-1.5 text-sm border border-gray-700"
        >
          <option value={100}>100 msgs</option>
          <option value={500}>500 msgs</option>
          <option value={1000}>1000 msgs</option>
        </select>
      </div>

      {/* Message count */}
      <div className="text-xs text-gray-500 mb-2">
        Showing {filteredMessages.length} of {displayedMessages.length} messages
        {unknownSignals.length > 0 && (
          <span className="ml-2 text-yellow-500">
            ({unknownSignals.length} unknown IDs detected)
          </span>
        )}
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="bg-gray-800 rounded border border-gray-700 overflow-y-auto font-mono text-sm"
        style={{ maxHeight: '400px' }}
      >
        <table className="w-full">
          <thead className="bg-gray-900 sticky top-0">
            <tr className="text-left text-xs text-gray-400">
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">CAN ID</th>
              <th className="px-3 py-2">DLC</th>
              <th className="px-3 py-2">Data (Hex)</th>
            </tr>
          </thead>
          <tbody>
            {filteredMessages.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-3 py-4 text-center text-gray-500">
                  No messages received yet
                </td>
              </tr>
            ) : (
              filteredMessages.map((msg, idx) => (
                <tr
                  key={idx}
                  className="border-t border-gray-700 hover:bg-gray-750"
                  style={{ borderLeft: `3px solid ${getMessageColor(msg.can_id)}` }}
                >
                  <td className="px-3 py-1.5 text-xs text-gray-400">
                    {new Date(msg.timestamp * 1000).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="font-semibold">{msg.can_id_hex}</span>
                    <span className="text-xs text-gray-500 ml-1">({msg.can_id})</span>
                  </td>
                  <td className="px-3 py-1.5 text-center">{msg.dlc}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {msg.data_hex.match(/.{1,2}/g)?.join(' ') || msg.data_hex}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Unknown Signals Section */}
      {unknownSignals.length > 0 && (
        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded">
          <h3 className="text-sm font-semibold text-yellow-500 mb-2">
            Unknown CAN IDs Detected
          </h3>
          <div className="text-xs text-gray-400">
            {unknownSignals.map((sig, idx) => (
              <div key={idx} className="flex items-center gap-2 py-1">
                <span className="font-mono text-yellow-400">
                  0x{sig.can_id.toString(16).toUpperCase().padStart(3, '0')}
                </span>
                <span className="text-gray-500">- Received at {new Date(sig.timestamp * 1000).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TraceWindow;