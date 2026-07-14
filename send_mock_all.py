#!/usr/bin/env python3
import time
import can
import logging
import random
from can_utils.encode_signal import signal_definitions, encode_signals_to_frames

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

CYCLE_INTERVAL_S = 0.05


def random_value(sig_config):
    data_type = sig_config[1]
    min_val = sig_config[3]
    max_val = sig_config[4]

    if data_type == 'float':
        if min_val == max_val:
            return float(min_val)
        return random.uniform(float(min_val), float(max_val))
    if data_type in ('bool', 'boolean'):
        return random.choice([True, False])
    if data_type == 'uint8':
        return random.randint(int(min_val), int(max_val))
    return 0


def main():
    try:
        bus = can.interface.Bus(channel='can0', bustype='socketcan')
    except Exception as e:
        logging.error(f"Failed to open CAN bus: {e}")
        return

    signals = list(signal_definitions.keys())
    logging.info(
        "Starting merged-frame mock sender for %d signals (one frame per CAN ID)...",
        len(signals),
    )

    try:
        while True:
            values = {
                sig_name: random_value(signal_definitions[sig_name])
                for sig_name in signals
            }
            frames = encode_signals_to_frames(values)

            sent = 0
            for can_id, data_bytes in sorted(frames.items()):
                msg = can.Message(
                    arbitration_id=can_id,
                    data=data_bytes,
                    is_extended_id=False,
                )
                try:
                    bus.send(msg)
                    sent += 1
                    logging.debug("Sent 0x%03X data=%s", can_id, data_bytes.hex())
                except Exception as e:
                    logging.error(f"Send error for 0x{can_id:03X}: {e}")

            logging.info(
                "Cycle complete: %d CAN frames for %d signals (soc=%.1f, pack_voltage=%.1f)",
                sent,
                len(values),
                float(values.get('soc', 0)),
                float(values.get('pack_voltage', 0)),
            )
            time.sleep(CYCLE_INTERVAL_S)

    except KeyboardInterrupt:
        logging.info("Stopped by user")
    finally:
        bus.shutdown()


if __name__ == "__main__":
    main()
