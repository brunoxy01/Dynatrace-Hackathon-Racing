import struct
import unittest
from pathlib import Path

from ams2_udp_listener import HEADER_SIZE, parse_header
from cars2_telemetry_generator import (
    TelemetryVariations,
    apply_telemetry_variations,
    load_capture,
    rewrite_packet_number,
)


CAPTURE = Path(__file__).parent / "captura.txt"


class Cars2TelemetryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.packets = load_capture(CAPTURE)

    def test_real_first_packet_header(self):
        packet = self.packets[0].payload

        self.assertEqual(12, HEADER_SIZE)
        self.assertEqual(
            {
                "packet_number": 6300,
                "category_packet_number": 3056,
                "partial_packet_index": 1,
                "partial_packet_number": 1,
                "packet_type": "telemetry",
                "packet_type_raw": 0,
                "packet_version": 4,
            },
            parse_header(packet),
        )
        self.assertEqual(bytes.fromhex("0000000000026400"), packet[HEADER_SIZE : HEADER_SIZE + 8])

    def test_real_second_packet_is_timings(self):
        header = parse_header(self.packets[1].payload)

        self.assertEqual("timings", header["packet_type"])
        self.assertEqual(3, header["packet_type_raw"])
        self.assertEqual(1, header["packet_version"])
        self.assertEqual(1063, len(self.packets[1].payload))

    def test_rewrite_changes_only_packet_number(self):
        original = self.packets[0].payload
        rewritten = rewrite_packet_number(original, 123456)

        self.assertEqual(123456, struct.unpack_from("<I", rewritten)[0])
        self.assertEqual(original[4:], rewritten[4:])

    def test_variations_change_confirmed_telemetry_fields(self):
        original = next(
            packet.payload
            for packet in self.packets
            if packet.payload[10] == 0
            and 0 < packet.payload[29] < 255
            and 0 < packet.payload[30] < 255
        )
        variations = TelemetryVariations(
            speed_pct=10,
            throttle_pct=-20,
            brake_pct=25,
            gear_pct=-50,
            acceleration_pct=15,
            position_x_pct=5,
            position_y_pct=-10,
        )

        rewritten = apply_telemetry_variations(original, variations)

        self.assertEqual(round(original[30] * 0.8), rewritten[30])
        self.assertEqual(round(original[29] * 1.25), rewritten[29])
        self.assertAlmostEqual(
            struct.unpack_from("<f", original, 36)[0] * 1.1,
            struct.unpack_from("<f", rewritten, 36)[0],
            places=4,
        )
        self.assertEqual(original[45] & 0xF0, rewritten[45] & 0xF0)
        self.assertEqual(round((original[45] & 0x0F) * 0.5), rewritten[45] & 0x0F)
        for offset in (100, 104, 108):
            self.assertAlmostEqual(
                struct.unpack_from("<f", original, offset)[0] * 1.15,
                struct.unpack_from("<f", rewritten, offset)[0],
                places=4,
            )
        self.assertAlmostEqual(
            struct.unpack_from("<f", original, 542)[0] * 1.05,
            struct.unpack_from("<f", rewritten, 542)[0],
            places=4,
        )
        self.assertAlmostEqual(
            struct.unpack_from("<f", original, 550)[0] * 0.9,
            struct.unpack_from("<f", rewritten, 550)[0],
            places=4,
        )

    def test_variations_preserve_non_telemetry_packet(self):
        timings = next(packet.payload for packet in self.packets if packet.payload[10] == 3)

        self.assertIs(
            timings,
            apply_telemetry_variations(timings, TelemetryVariations(speed_pct=50)),
        )

    def test_zero_variations_preserve_telemetry_bytes(self):
        telemetry = next(packet.payload for packet in self.packets if packet.payload[10] == 0)

        self.assertEqual(telemetry, apply_telemetry_variations(telemetry, TelemetryVariations()))


if __name__ == "__main__":
    unittest.main()