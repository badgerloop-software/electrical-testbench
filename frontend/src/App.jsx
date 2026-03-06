import { useEffect, useState, useRef } from "react";
import "./App.css";
import Dashboard from "./components/Dashboard";

const server = import.meta.env.VITE_PI_PORT ? Number(import.meta.env.VITE_PI_PORT) : 8765;
const host = import.meta.env.VITE_PI_HOST || window.location.hostname;

function App() {
  const [ws, setWs] = useState(null);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [receivedSignals, setReceivedSignals] = useState({});
  const [rawMessages, setRawMessages] = useState([]);
  const [unknownSignals, setUnknownSignals] = useState([]);
  const [canBitrate, setCanBitrate] = useState(500000);
  const [availableBitrates, setAvailableBitrates] = useState([125000, 250000, 500000, 1000000]);
  const connected = useRef(false);

  useEffect(() => {
    if (connected.current) return;
    connected.current = true;

    const websocket = new WebSocket(`ws://${host}:${server}`);

    websocket.onopen = () => {
      console.log("Connected to Python WebSocket Server");
      setWs(websocket);
      setWsStatus('connected');
    };

    websocket.onmessage = (event) => {
      console.log("Received from backend:", event.data);
      try {
        const data = JSON.parse(event.data);

        // Handle bitrate status messages
        if (data.type === "bitrate_status") {
          setCanBitrate(data.bitrate);
          setAvailableBitrates(data.available_bitrates || [125000, 250000, 500000, 1000000]);
          return;
        }

        // Handle bitrate change response
        if (data.type === "bitrate_response") {
          if (data.success) {
            setCanBitrate(data.bitrate);
            console.log("Bitrate changed to:", data.bitrate);
          } else {
            console.error("Bitrate change failed:", data.message);
          }
          return;
        }

        // Handle raw CAN messages for trace window
        if (data.type === "raw_message") {
          setRawMessages(prev => [...prev, data]);
          return;
        }

        // Handle unknown signals
        if (data.is_unknown) {
          setUnknownSignals(prev => {
            // Only add if not already in list
            if (!prev.some(s => s.can_id === data.can_id && s.timestamp === data.timestamp)) {
              return [...prev, data];
            }
            return prev;
          });
          return;
        }

        // Update received signals with timestamp
        if (data.signal_name && data.value !== undefined) {
          setReceivedSignals(prev => ({
            ...prev,
            [data.signal_name]: {
              value: data.value,
              timestamp: data.timestamp || Date.now() / 1000,
              can_id: data.can_id
            }
          }));
        }
      } catch (err) {
        console.error("Failed to parse incoming message:", err);
      }
    };

    websocket.onerror = (err) => {
      console.error("WebSocket error:", err);
      setWsStatus('disconnected');
    };

    websocket.onclose = () => {
      console.log("WebSocket connection closed");
      connected.current = false;
      setWsStatus('disconnected');
    };

    return () => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
    };
  }, []);

  const handleBitrateChange = (newBitrate) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "set_bitrate",
        bitrate: newBitrate
      }));
    }
  };

  return (
    <Dashboard
      websocket={ws}
      wsStatus={wsStatus}
      receivedSignals={receivedSignals}
      rawMessages={rawMessages}
      unknownSignals={unknownSignals}
      canBitrate={canBitrate}
      availableBitrates={availableBitrates}
      onBitrateChange={handleBitrateChange}
    />
  );
}

export default App;
