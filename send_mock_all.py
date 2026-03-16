#!/usr/bin/env python3
import time
import can
import logging
import random
from can_utils.encode_signal import signal_definitions, encode_signal_to_can

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def main():
    try:
        bus = can.interface.Bus(channel='can0', bustype='socketcan')
    except Exception as e:
        logging.error(f"Failed to open CAN bus: {e}")
        return

    signals = list(signal_definitions.keys())
    logging.info(f"Starting to send mock data for {len(signals)} signals...")

    try:
        while True:
            for sig_name in signals:
                # Generate a random value based on type
                sig_config = signal_definitions[sig_name]
                data_type = sig_config[1]
                min_val = sig_config[3]
                max_val = sig_config[4]
                
                if data_type == 'float':
                    if min_val == max_val:
                        val = float(min_val)
                    else:
                        val = random.uniform(float(min_val), float(max_val))
                elif data_type == 'bool' or data_type == 'boolean':
                    val = random.choice([True, False])
                elif data_type == 'uint8':
                    val = random.randint(int(min_val), int(max_val))
                else:
                    val = 0
                
                result = encode_signal_to_can(sig_name, val)
                if result:
                    can_id, data_bytes = result
                    msg = can.Message(arbitration_id=can_id, data=data_bytes, is_extended_id=False)
                    try:
                        logging.debug(f"Attempting to send {sig_name}")
                        bus.send(msg)
                        logging.info(f"Sent {sig_name}={val} on 0x{can_id:03X}")
                    except Exception as e:
                        logging.error(f"Send error: {e}")
                
                time.sleep(0.05) # 20Hz total throughput
            
            logging.info("Finished one full cycle of signals. Restarting...")
            time.sleep(1)

    except KeyboardInterrupt:
        logging.info("Stopped by user")
    finally:
        bus.shutdown()

if __name__ == "__main__":
    main()
