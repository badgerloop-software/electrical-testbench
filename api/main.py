import asyncio
import websockets
import can
import json
import subprocess
from can_utils.read_can_messages import MyListener
from can_utils.encode_signal import encode_signal_to_can
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# why websockets? websockets allow the server to push updates to client in real
# time as supposed to HTTP requests, which require a client to repeatedly poll
# the server for new data

# Store active WebSocket connections (driver dashboard is a client )
clients = set()

# Setup CAN Bus Interface
bus = can.interface.Bus(channel="can0", bustype="socketcan")

# Default bitrate
CURRENT_BITRATE = 500000

# Valid bitrates
VALID_BITRATES = [125000, 250000, 500000, 1000000]


def set_can_bitrate(bitrate):
    """
    Change CAN bitrate by bringing interface down/up.
    Returns (success, message)
    """
    global CURRENT_BITRATE

    if bitrate not in VALID_BITRATES:
        return False, f"Invalid bitrate. Valid options: {VALID_BITRATES}"

    try:
        # Bring can0 down
        subprocess.run(["ip", "link", "set", "can0", "down"], check=True)
        # Set new bitrate and bring up
        subprocess.run([
            "ip", "link", "set", "can0", "up", "type", "can", "bitrate", str(bitrate)
        ], check=True)

        CURRENT_BITRATE = bitrate
        # Reinitialize the CAN bus interface with new bitrate
        global bus
        bus = can.interface.Bus(channel="can0", bustype="socketcan")

        logging.info(f"CAN bitrate changed to {bitrate}")
        return True, f"Bitrate set to {bitrate}"
    except subprocess.CalledProcessError as e:
        logging.error(f"Failed to change bitrate: {e}")
        return False, str(e)
    except Exception as e:
        logging.error(f"Error changing bitrate: {e}")
        return False, str(e)


class WebSocketsListener(MyListener):
    def __init__(self, loop, send_to_clients):
        """
        param loop: Reference to the asyncio event loop.
        param send_to_clients: function that broadcasts messages to connected WebSocket clients.
        """
        self.loop = loop
        self.send_to_clients = send_to_clients

    def on_message_received(self, message):
        message_data = {
            "id": message.arbitration_id,
            "data": message.data,  # bytes object
            "timestamp": message.timestamp,
        }

        # Broadcast raw message for trace window
        raw_message = {
            "type": "raw_message",
            "can_id": message.arbitration_id,
            "can_id_hex": f"0x{message.arbitration_id:03X}",
            "dlc": len(message.data),
            "data_hex": message.data.hex(),
            "timestamp": message.timestamp,
        }
        self.loop.create_task(self.send_to_clients(json.dumps(raw_message)))

        # Parse the message using parse_data, if cannot parse (data/canID is invalid), parsed is None
        parsed_list = self.parse_data(message_data)
        if parsed_list:
            # Handle both single result and list of results
            if not isinstance(parsed_list, list):
                parsed_list = [parsed_list]
            for parsed in parsed_list:
                # Convert the parsed data into JSON.
                json_data = json.dumps(parsed.__dict__)
                # Send callback
                self.loop.create_task(self.send_to_clients(json_data))


# --- WebSocket Handler ---
async def handle_connection(websocket):
    clients.add(websocket)
    logging.info("Client connected")

    # Send current bitrate to newly connected client
    await websocket.send(json.dumps({
        "type": "bitrate_status",
        "bitrate": CURRENT_BITRATE,
        "available_bitrates": VALID_BITRATES
    }))

    try:
        async for message in websocket:
            logging.info(f"Received from client: {message}")

            # Handle incoming signal updates from dashboard
            try:
                data = json.loads(message)

                # Handle bitrate change request
                if data.get("type") == "set_bitrate":
                    bitrate = data.get("bitrate")
                    success, msg = set_can_bitrate(bitrate)
                    await websocket.send(json.dumps({
                        "type": "bitrate_response",
                        "success": success,
                        "message": msg,
                        "bitrate": CURRENT_BITRATE
                    }))
                    continue

                # Handle bitrate status request
                if data.get("type") == "get_bitrate":
                    await websocket.send(json.dumps({
                        "type": "bitrate_status",
                        "bitrate": CURRENT_BITRATE,
                        "available_bitrates": VALID_BITRATES
                    }))
                    continue

                # Handle signal updates
                if data.get("type") == "signal_update":
                    signal_name = data.get("signal_name")
                    value = data.get("value")

                    if signal_name and value is not None:
                        # Encode and send CAN message
                        result = encode_signal_to_can(signal_name, value)
                        if result:
                            can_id, data_bytes = result
                            can_msg = can.Message(
                                arbitration_id=can_id,
                                data=data_bytes,
                                is_extended_id=False
                            )
                            try:
                                bus.send(can_msg)
                                logging.info(f"Sent CAN message: {signal_name}={value}")
                            except can.CanError as e:
                                logging.error(f"Failed to send CAN message: {e}")
                        else:
                            logging.warning(f"Failed to encode signal: {signal_name}")
            except json.JSONDecodeError:
                logging.warning(f"Received non-JSON message: {message}")
            except Exception as e:
                logging.error(f"Error processing message: {e}")

    except websockets.exceptions.ConnectionClosed:
        logging.info("Client disconnected")
    finally:
        clients.remove(websocket)


# --- Broadcast Helper ---
async def send_to_clients(message: str):
    if clients:
        await asyncio.wait(
            [asyncio.create_task(client.send(message)) for client in clients]
        )


async def start_server():
    server = await websockets.serve(handle_connection, "0.0.0.0", 8765)
    loop = asyncio.get_running_loop()
    # Create the WebsocketsListener, passing the loop and send_to_clients callback.
    ws_listener = WebSocketsListener(loop, send_to_clients)
    notifier = can.Notifier(bus, [ws_listener])
    await asyncio.Future()  # Run indefinitely.


if __name__ == "__main__":
    asyncio.run(start_server())
