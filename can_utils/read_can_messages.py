import can
import struct
import time
import logging
from can_utils.send_messages import transmit_can_message
import argparse
from typing import List, Dict, Any
import json
from can_utils.data_classes import SignalInfo, ParsedData
import os

"""
Message structure: 
.arbitration_id: id of the CAN message
.data: the body content of the CAN message
.timestamp: the timestamp of the CAN message
"""


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


def preprocess_data_format(format: Dict[str, List[Any]]) -> Dict[str, Dict[int, Any]]:
    """
    Parse data format and return in a more friendly format for  CAN consumption:
    <CAN ID>: {
        <offset>: {
            <category 1>: ...
            ...
        }
        ...
    },
    ...
    """
    processed = {}
    for key, s in format.items():
        # Get the arbitration ID and offset
        can_id = int(s[-2], base=16)
        offset = s[-1]
        # Drop the ID and offset
        s = s[:-2]
        # Add/Update the message data in the processed data format
        p = processed.setdefault(can_id, {})
        num_bytes = s[0]
        data_type = s[1]
        units = s[2]
        nominal_min = s[3]
        nominal_max = s[4]
        subsystem = s[5]
        signal_info = SignalInfo(
            key, num_bytes, data_type, units, nominal_min, nominal_max, subsystem
        )
        p[offset] = signal_info

    return processed


base_dir = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.normpath(
    os.path.join(base_dir, "..", "sc1-data-format", "format.json")
)

with open(json_path, "r") as f:
    data = json.load(f)


signal_definitions = preprocess_data_format(data)


class MyListener(can.Listener):
    def on_message_received(self, message):
        self.parse_data(message)

    def parse_data(self, message_data):
        # get can_id
        can_id = message_data["id"]
        # loop to find can_id
        if can_id not in signal_definitions:
            logging.error(f"CAN ID {can_id:0x} not found in signal definitions.")
            return None
        signals = signal_definitions[can_id]
        byte_array = bytes(message_data["data"])

        for offset, signals_info in signals.items():
            logging.debug(
                f"Processing signal at offset {offset} for CAN ID {can_id:0x}"
            )
            data_type = signals_info.type
            signal_name = signals_info.name
            num_bytes = signals_info.bytes

            # Offset in format.json is in bits. Convert to byte index + bit index
            byte_index = int(offset) // 8
            bit_index = int(offset) % 8

            try:
                if data_type == "float":
                    # Support 4-byte IEEE float and also 2-byte 'float' treated as int->float fallback
                    if num_bytes >= 4:
                        if len(byte_array) >= byte_index + 4:
                            value = struct.unpack_from("<f", byte_array, byte_index)[0]
                        else:
                            logging.error(f"Insufficient data for float signal '{signal_name}' in CAN ID {can_id:0x}.")
                            return None
                    elif num_bytes == 2:
                        # Fallback: read as signed 16-bit and use as float
                        if len(byte_array) >= byte_index + 2:
                            raw = struct.unpack_from("<h", byte_array, byte_index)[0]
                            value = float(raw)
                        else:
                            logging.error(f"Insufficient data for 2-byte float signal '{signal_name}' in CAN ID {can_id:0x}.")
                            return None
                    else:
                        # 1-byte float fallback
                        if len(byte_array) > byte_index:
                            value = float(byte_array[byte_index])
                        else:
                            logging.error(f"Insufficient data for 1-byte float signal '{signal_name}' in CAN ID {can_id:0x}.")
                            return None

                    logging.debug(
                        f"New Message: ID={can_id:0x},Name={signal_name} Value={value}, Time Stamp={message_data['timestamp']}"
                    )
                    return ParsedData(can_id, signal_name, value, message_data["timestamp"])

                elif data_type in ("bool", "boolean"):
                    # Determine the byte and bit and extract boolean
                    if len(byte_array) > byte_index:
                        bool_value = bool((byte_array[byte_index] >> bit_index) & 1)
                        logging.debug(
                            f"New Message: ID={can_id:0x},Name={signal_name} Value={bool_value}, Time Stamp={message_data['timestamp']}"
                        )
                        return ParsedData(can_id, signal_name, bool_value, message_data["timestamp"])
                    else:
                        logging.error(f"Insufficient data for boolean signal '{signal_name}' in CAN ID {can_id:0x}.")
                        return None

                elif data_type in ("uint8", "uint16", "uint32", "uint64", "int8", "int16"):
                    fmt = None
                    if num_bytes == 1:
                        fmt = "<B"
                    elif num_bytes == 2:
                        fmt = "<H"
                    elif num_bytes == 4:
                        fmt = "<I"
                    elif num_bytes == 8:
                        fmt = "<Q"

                    if fmt and len(byte_array) >= byte_index + num_bytes:
                        raw = struct.unpack_from(fmt, byte_array, byte_index)[0]
                        value = float(raw)
                        logging.debug(
                            f"New Message: ID={can_id:0x},Name={signal_name} Value={value}, Time Stamp={message_data['timestamp']}"
                        )
                        return ParsedData(can_id, signal_name, value, message_data["timestamp"])
                    else:
                        logging.error(f"Insufficient data for integer signal '{signal_name}' in CAN ID {can_id:0x}.")
                        return None

                else:
                    logging.debug(f"Unhandled data type '{data_type}' for signal '{signal_name}'")
                    return None

            except struct.error as e:
                logging.error(f"Struct error while parsing signal '{signal_name}' in CAN ID {can_id:0x}: {e}")
                return None


if __name__ == "__main__":
    # Create a CAN bus connection
    bus = can.interface.Bus(channel="can0", bustype="socketcan")

    # set up listener
    listener = MyListener()

    # A Notifier runs in the background and listens for messages. When a new message arrives, it calls on_message in MyListener.
    notifier = can.Notifier(bus, [listener])

    try:
        # create an infinite loop to keep listening to messages.
        logging.debug("Listening for CAN messages... Press Ctrl+C to stop.")
        parser = argparse.ArgumentParser(description="Specify the CAN channel.")
        # Define a positional argument for channel
        parser.add_argument("channel", type=str, help="CAN channel (e.g., can0, vcan0)")
        args = parser.parse_args()
        transmit_can_message()
        while True:
            time.sleep(1)
            # Infinite loop to keep listening
    except KeyboardInterrupt:
        logging.debug("Stopping CAN receiver.")
        notifier.stop()
        bus.shutdown()
