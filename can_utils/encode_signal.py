#!/usr/bin/env python3
"""
Utility to encode signal values into CAN messages and send them.
This allows the frontend dashboard to control signals via WebSocket -> CAN bus.
"""

import struct
import json
import os
from typing import Any, Dict
import logging

# Load signal definitions from JSON
base_dir = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.normpath(
    os.path.join(base_dir, "..", "sc1-data-format", "format.json")
)

with open(json_path, "r") as f:
    signal_definitions = json.load(f)


def encode_signal_to_can(signal_name: str, value: Any) -> tuple[int, bytes] | None:
    """
    Encode a signal name and value into a CAN message.
    
    Args:
        signal_name: Name of the signal (e.g., "accelerator_pedal")
        value: Value to encode (float, int, or bool)
    
    Returns:
        Tuple of (can_id, data_bytes) or None if signal not found
    """
    if signal_name not in signal_definitions:
        logging.error(f"Signal '{signal_name}' not found in definitions")
        return None
    
    signal_config = signal_definitions[signal_name]
    
    # Format: [bytes, type, units, min, max, subsystem, can_id, offset]
    num_bytes = signal_config[0]
    data_type = signal_config[1]
    can_id = int(signal_config[-2], 16)  # Convert hex string to int
    offset = signal_config[-1]
    
    # Encode value based on data type
    try:
        if data_type == "float":
            # Pack as little-endian float (4 bytes)
            data_bytes = struct.pack('<f', float(value))
        elif data_type == "uint8":
            # Pack as unsigned byte
            data_bytes = struct.pack('B', int(value))
        elif data_type == "bool":
            # Pack as single byte (0 or 1)
            data_bytes = struct.pack('B', 1 if value else 0)
        else:
            logging.error(f"Unknown data type '{data_type}' for signal '{signal_name}'")
            return None
        
        # Pad to 8 bytes for CAN message (standard practice)
        data_bytes = data_bytes + b'\x00' * (8 - len(data_bytes))
        
        logging.info(f"Encoded {signal_name}={value} -> CAN ID: 0x{can_id:03x}, Data: {data_bytes.hex()}")
        return (can_id, data_bytes)
    
    except (ValueError, struct.error) as e:
        logging.error(f"Failed to encode signal '{signal_name}' with value {value}: {e}")
        return None


def get_signal_info(signal_name: str) -> Dict | None:
    """Get signal configuration for a given signal name."""
    if signal_name not in signal_definitions:
        return None
    
    config = signal_definitions[signal_name]
    return {
        "name": signal_name,
        "bytes": config[0],
        "type": config[1],
        "units": config[2],
        "min": config[3],
        "max": config[4],
        "subsystem": config[5],
        "can_id": config[-2],
        "offset": config[-1]
    }
