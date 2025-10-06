# Electrical Test Bench Project

This project involves developing a comprehensive user interface for an electrical test board that interfaces with CAN (Controller Area Network) communication. The system serves as a tester board for electrical members to mock and read signals over CAN networks, displaying real-time telemetry data received from CAN networks and providing the ability to mock CAN inputs.

Link to docs https://www.waveshare.com/wiki/RS485_CAN_HAT#Install_Library

CAN Messages: https://docs.google.com/spreadsheets/d/12O2UPdM_fqUVKd0IXZ638wb1obtBXQp11giv7swfWM4/edit?gid=575020774#gid=575020774

## Project Structure

```
can-snooper/
├── api/                           # WebSocket server for real-time CAN data
│   ├── __init__.py
│   └── main.py                    # WebSocket server with real CAN bus
├── can_utils/                     # Utility modules for CAN operations
│   ├── __init__.py
│   ├── data_classes.py           # Data structures for CAN messages
│   ├── read_can_messages.py      # Enhanced CAN message reader with parsing
│   └── send_messages.py          # CAN message transmission utilities
├── frontend/                      # React web dashboard
│   ├── src/
│   ├── package.json
│   └── ...                       # React/Vite frontend files
├── sc1-data-format/              # Git submodule for CAN signal definitions
├── mock_messages.py              # WebSocket server with simulated CAN data
├── read_can_messages.py          # Simple CAN message listener
├── send_messages.py              # Simple CAN message sender
├── requirements.txt              # Python dependencies
└── README.md
```

## Setup Instructions

### 1. Initialize Submodules

This project uses git submodules. After cloning, initialize them with:

```bash
git submodule update --init --recursive
```

### 2. Create Virtual Environment

Create virtual environment using:

- Windows: `virtualenv -p python3 .env`
- Linux/MacOS: `python3 -m venv .env`

### 3. Activate Virtual Environment

Activate the virtual environment you created:

- Windows: `.env\Scripts\activate`
- Linux/MacOS: `source .env/bin/activate`

### 4. Install Dependencies

Install the required Python libraries:

```bash
pip install -r requirements.txt
```

## Usage Instructions

### For CAN Message Listening

#### Simple Console Listener (Utility Module)

Listen to CAN messages and print decoded values to console:

```bash
python read_can_messages.py
```

- Connects to `can0` by default
- Displays decoded signal names and values
- Press `Ctrl+C` to stop

#### WebSocket Server (Real CAN Bus)

Start WebSocket server that broadcasts real CAN data to connected clients:

```bash
python api/main.py
```

- Listens on CAN bus `can0`
- WebSocket server runs on `ws://localhost:8765`
- Broadcasts parsed CAN messages as JSON to all connected clients via Websocket server

#### Mock Data Server (Development/Testing Frontend)

Start WebSocket server with simulated CAN data for testing:

```bash
python mock_messages.py
```

- Generates fake CAN messages every 2 seconds
- WebSocket server runs on `ws://localhost:8765`
- Useful for frontend development without real CAN hardware

### For CAN Message Sending (Utility Module)

Send custom CAN messages interactively:

```bash
python send_messages.py <channel>
```

Example:

```bash
python send_messages.py can0
```

The script will prompt you for:

- **Message ID**: Enter hex ID (e.g., `0x123`)
- **Data bytes**: Enter hex bytes separated by spaces (e.g., `11 22 33 44`)

### For Web Dashboard

#### Setup Frontend

Navigate to the frontend directory and install dependencies:

```bash
cd frontend
npm install
```

#### Run Development Server

Start the React development server:

```bash
npm run dev
```

- Frontend runs on `http://localhost:5173`
- Connects to WebSocket server for real-time CAN data

## Common Use Cases

1. **Development & Testing**: Use `mock_messages.py` + frontend for UI development
2. **Real Vehicle Testing**: Use `api/main.py` + frontend for live CAN monitoring
3. **Debugging CAN Issues**: Use `read_can_messages.py` for quick console output
4. **Sending Test Messages**: Use `send_messages.py` to inject test CAN messages

## Requirements

- **Hardware**: CAN interface (e.g., Waveshare RS485 CAN HAT)
- **OS**: Linux with SocketCAN support (for real CAN bus)
- **Python**: 3.7+ with `python-can` and `websockets` libraries
- **Node.js**: For frontend development
