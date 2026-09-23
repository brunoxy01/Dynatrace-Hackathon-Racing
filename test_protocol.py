import unittest
from pathlib import Path
from ams2_collector import Collector
from ams2_protocol import decode_header, decode_vehicle_names


class CaptureRegressionTests(unittest.TestCase):
    def test_class_packets_do_not_replace_vehicle_and_completed_lap_is_preserved(self):
        collector = Collector('test-rig', 'Test', 'capture', 'real')
        cars, last_laps = set(), set()
        count = 0
        for line in Path(__file__).with_name('captura.txt').read_text().splitlines():
            raw = bytes.fromhex(line.split('\t')[3])
            if decode_header(raw).packet_type == 8 and len(raw) == 1452:
                self.assertEqual({}, decode_vehicle_names(raw, len(raw)))
            event = collector.handle_packet(raw)
            if event:
                count += 1
                if event['car_name']:
                    cars.add(event['car_name'])
                if event['last_lap_s']:
                    last_laps.add(event['last_lap_s'])
                # Recorded lap was not marked as a fastest valid lap by AMS2.
                self.assertIsNone(event['best_lap_s'])
        self.assertEqual(count, 7236)
        self.assertEqual(cars, {'Formula Ultimate Hybrid Gen2'})
        self.assertIn(104.015, last_laps)


if __name__ == '__main__':
    unittest.main()
