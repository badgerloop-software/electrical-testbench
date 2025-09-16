import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Circle, Pause, Play, Trash2 } from 'lucide-react';

const server = 8765;

type canMessage = {
  can_id: number;
  signal_name: string;
  value: number;
  timestamp: number;
};

function App() {
  const [messages, setMessages] = useState<canMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);

  // Keep paused value available inside onmessage
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Create WebSocket once on mount
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:${server}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data: canMessage = JSON.parse(event.data);
        if (!pausedRef.current) {
          setMessages((prev) => [...prev, data]);
        }
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      try { ws.close(); } catch {}
      setIsConnected(false);
    };
  }, []);

  const clear = () => setMessages([]);
  const togglePause = () => setPaused((p) => !p);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        `${m.signal_name}`.toLowerCase().includes(q) ||
        `${m.can_id}`.includes(q)
    );
  }, [messages, query]);

  const view = useMemo(() => {
    const last = filtered.slice(-200);
    return last.slice().reverse();
  }, [filtered]);

  const totalSignals = useMemo(
    () => new Set(messages.map((m) => m.signal_name)).size,
    [messages]
  );

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Circle
              className={
                isConnected ? 'text-green-500' : 'text-muted-foreground'
              }
            />
            <span className="font-semibold">CAN Snooper</span>
            <Badge
              variant="secondary"
              className={isConnected ? 'bg-green-500 text-white' : ''}
            >
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by signal or CAN ID"
              className="w-64"
            />
            <Button variant="outline" onClick={clear} title="Clear messages">
              <Trash2 />
              Clear
            </Button>
            <Button
              onClick={togglePause}
              variant={paused ? 'secondary' : 'default'}
            >
              {paused ? <Play /> : <Pause />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        <div className="flex gap-4 text-sm">
          <div className="rounded-md border px-3 py-2">
            <div className="text-muted-foreground">Total messages</div>
            <div className="text-lg font-medium">{messages.length}</div>
          </div>
          <div className="rounded-md border px-3 py-2">
            <div className="text-muted-foreground">Unique signals</div>
            <div className="text-lg font-medium">{totalSignals}</div>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Live Messages</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>CAN ID</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.map((m, idx) => (
                  <TableRow key={`${m.timestamp}-${idx}`}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(m.timestamp * 1000).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="font-mono">
                      0x{m.can_id.toString(16).toUpperCase()}
                    </TableCell>
                    <TableCell>{m.signal_name}</TableCell>
                    <TableCell className="text-right font-mono">
                      {String(m.value)}
                    </TableCell>
                  </TableRow>
                ))}
                {view.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground"
                    >
                      No messages yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default App;
