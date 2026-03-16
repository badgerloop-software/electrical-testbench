import struct
import json
import os
import logging
from typing import Any

base_dir = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.normpath(os.path.join(base_dir, "..", "sc-data-format", "format.json"))

with open(json_path, "r") as f:
    signal_definitions = json.load(f)

DIAG_ID_START = 0x700
DIAG_ID_END = 0x7FF
fff_signal_ids = {}
diag_id_counter = DIAG_ID_START

for sig_name, sig_config in signal_definitions.items():
    if sig_config[-2].upper() == "FFF":
        if diag_id_counter <= DIAG_ID_END:
            fff_signal_ids[sig_name] = diag_id_counter
            diag_id_counter += 1

def encode_signal_to_can(signal_name: str, value: Any) -> tuple[int, bytes] | None:
    if signal_name not in signal_definitions:
        return None
    
    config = signal_definitions[signal_name]
    num_bytes = config[0]
    data_type = config[1]
    can_id_hex = config[-2]
    can_id = int(can_id_hex, 16) if can_id_hex.upper() != "FFF" else fff_signal_ids.get(signal_name)
    offset = config[-1]
    
    if can_id is None: return None

    data_bytes = bytearray(8)
    try:
        byte_idx = offset // 8
        bit_idx = offset % 8
        
        if data_type == "float":
            if num_bytes == 2:
                fmt = '<e'
            elif num_bytes == 8:
                fmt = '<d'
            else:
                fmt = '<f' # Default to 4 bytes
            val_bytes = struct.pack(fmt, float(value))
            data_bytes[byte_idx:byte_idx+len(val_bytes)] = val_bytes
        elif data_type == "uint8":
            data_bytes[byte_idx] = int(value) & 0xFF
        elif data_type in ["bool", "boolean"]:
            if value:
                data_bytes[byte_idx] |= (1 << bit_idx)
            else:
                data_bytes[byte_idx] &= ~(1 << bit_idx)
        # Handle other integer types if num_bytes > 1
        elif data_type.startswith("int") or data_type.startswith("uint"):
            if num_bytes == 2: fmt = '<h' if data_type.startswith("int") else '<H'
            elif num_bytes == 4: fmt = '<i' if data_type.startswith("int") else '<I'
            elif num_bytes == 8: fmt = '<q' if data_type.startswith("int") else '<Q'
            else: fmt = None
            if fmt:
                val_bytes = struct.pack(fmt, int(value))
                data_bytes[byte_idx:byte_idx+len(val_bytes)] = val_bytes
        
        return (can_id, bytes(data_bytes))
    except Exception as e:
        logging.error(f"Encode error {signal_name}: {e}")
        return None
