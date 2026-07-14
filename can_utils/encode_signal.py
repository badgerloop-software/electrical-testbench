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
    os.path.join(base_dir, "..", "sc-data-format", "format.json")
)

with open(json_path, "r") as f:
    signal_definitions = json.load(f)

# Diagnostic ID range for temporary FFF signal assignments (0x700-0x7FF)
DIAG_ID_START = 0x700
DIAG_ID_END = 0x7FF

# Generate consistent temporary diagnostic IDs for FFF signals
# This creates a deterministic mapping based on signal name hash
fff_signal_ids = {}
diag_id_counter = DIAG_ID_START

for sig_name, sig_config in signal_definitions.items():
    if sig_config[-2].upper() == "FFF":
        if diag_id_counter <= DIAG_ID_END:
            fff_signal_ids[sig_name] = diag_id_counter
            diag_id_counter += 1
        else:
            logging.warning(f"Ran out of diagnostic IDs for FFF signal '{sig_name}'")


def _clamp(value: float, vmin: float, vmax: float) -> float:
    lower = min(vmin, vmax)
    upper = max(vmin, vmax)
    return max(lower, min(upper, value))


def _scale_to_uint16(value: float, vmin: float, vmax: float) -> int:
    """Map a physical value into a 16-bit unsigned scalar using nominal range."""
    if vmax == vmin:
        return int(round(_clamp(value, vmin, vmax)))
    clamped = _clamp(value, vmin, vmax)
    ratio = (clamped - vmin) / (vmax - vmin)
    return int(round(ratio * 65535))


def _scale_to_uint8(value: float, vmin: float, vmax: float) -> int:
    if vmax == vmin:
        return int(round(_clamp(value, vmin, vmax))) & 0xFF
    clamped = _clamp(value, vmin, vmax)
    ratio = (clamped - vmin) / (vmax - vmin)
    return int(round(ratio * 255)) & 0xFF


def _write_bytes(frame: bytearray, bit_offset: int, data: bytes) -> None:
    if bit_offset % 8 != 0:
        raise ValueError(f"bit offset {bit_offset} is not byte-aligned")
    byte_idx = bit_offset // 8
    if byte_idx + len(data) > len(frame):
        raise ValueError(
            f"signal data ({len(data)} bytes @ bit {bit_offset}) exceeds CAN frame"
        )
    frame[byte_idx : byte_idx + len(data)] = data


def _write_bool(frame: bytearray, bit_offset: int, value: Any) -> None:
    byte_idx = bit_offset // 8
    bit_idx = bit_offset % 8
    if byte_idx >= len(frame):
        raise ValueError(f"bool bit offset {bit_offset} exceeds CAN frame")
    if value:
        frame[byte_idx] |= 1 << bit_idx
    else:
        frame[byte_idx] &= ~(1 << bit_idx)


def resolve_can_id(signal_name: str) -> int | None:
    """Return the arbitration ID for a signal, including FFF diagnostic mapping."""
    if signal_name not in signal_definitions:
        return None

    signal_config = signal_definitions[signal_name]
    can_id_hex = signal_config[-2]
    if can_id_hex.upper() == "FFF":
        return fff_signal_ids.get(signal_name)
    return int(can_id_hex, 16)


def encode_signal_into_frame(frame: bytearray, signal_name: str, value: Any) -> bool:
    """Merge one encoded signal into an existing 8-byte CAN payload."""
    if signal_name not in signal_definitions:
        logging.error(f"Signal '{signal_name}' not found in definitions")
        return False

    signal_config = signal_definitions[signal_name]
    num_bytes = signal_config[0]
    data_type = signal_config[1]
    nom_min = float(signal_config[3])
    nom_max = float(signal_config[4])
    offset = int(signal_config[-1])

    try:
        if data_type == "float":
            if num_bytes >= 4:
                payload = struct.pack("<f", float(value))
            elif num_bytes == 2:
                raw = _scale_to_uint16(float(value), nom_min, nom_max)
                payload = struct.pack("<H", raw)
            elif num_bytes == 1:
                raw = _scale_to_uint8(float(value), nom_min, nom_max)
                payload = struct.pack("B", raw)
            else:
                logging.error(
                    f"Unsupported float width {num_bytes} for signal '{signal_name}'"
                )
                return False
            _write_bytes(frame, offset, payload)
        elif data_type == "uint8":
            payload = struct.pack("B", int(value) & 0xFF)
            _write_bytes(frame, offset, payload)
        elif data_type in ("bool", "boolean"):
            _write_bool(frame, offset, value)
        else:
            logging.error(f"Unknown data type '{data_type}' for signal '{signal_name}'")
            return False
        return True
    except (ValueError, struct.error) as e:
        logging.error(f"Failed to encode signal '{signal_name}' with value {value}: {e}")
        return False


def encode_signal_to_can(signal_name: str, value: Any) -> tuple[int, bytes] | None:
    """
    Encode a signal name and value into a CAN message.

    Returns:
        Tuple of (can_id, data_bytes) or None if signal not found
    """
    can_id = resolve_can_id(signal_name)
    if can_id is None:
        if signal_name not in signal_definitions:
            logging.error(f"Signal '{signal_name}' not found in definitions")
        else:
            logging.error(
                f"Signal '{signal_name}' has placeholder ID FFF but no diagnostic ID available"
            )
        return None

    frame = bytearray(8)
    if not encode_signal_into_frame(frame, signal_name, value):
        return None

    data_bytes = bytes(frame)
    logging.info(
        f"Encoded {signal_name}={value} -> CAN ID: 0x{can_id:03x}, Data: {data_bytes.hex()}"
    )
    return (can_id, data_bytes)


def encode_signals_to_frames(values: Dict[str, Any]) -> Dict[int, bytes]:
    """Encode many signals, merging payloads that share the same CAN ID."""
    frames: Dict[int, bytearray] = {}
    for signal_name, value in values.items():
        can_id = resolve_can_id(signal_name)
        if can_id is None:
            continue
        frame = frames.setdefault(can_id, bytearray(8))
        encode_signal_into_frame(frame, signal_name, value)
    return {can_id: bytes(frame) for can_id, frame in frames.items()}


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
        "offset": config[-1],
    }
