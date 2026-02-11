import { useEffect, useState, useRef } from "react";
import "./App.css";
import Dashboard from "./components/Dashboard";

const server = 8765;

function App() {
  const [ws, setWs] = useState(null);
  const [receivedSignals, setReceivedSignals] = useState({});
  const connected = useRef(false);

  useEffect(() => {
    if (connected.current) return;
    connected.current = true;

    const websocket = new WebSocket(`ws://localhost:${server}`);

    websocket.onopen = () => {
      console.log("Connected to Python WebSocket Server");
      setWs(websocket);
    };

    websocket.onmessage = (event) => {
      console.log("Received from backend:", event.data);
      try {
        const data = JSON.parse(event.data);
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
    };

    websocket.onclose = () => {
      console.log("WebSocket connection closed");
      connected.current = false;
    };

    return () => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
    };
  }, []);

  return (
    <Dashboard websocket={ws} receivedSignals={receivedSignals} />
  );
}

export default App;
