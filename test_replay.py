import json
import unittest
from pathlib import Path
from replay_server import Replay, recorded_lap

class ReplayTests(unittest.TestCase):
    def test_capture_includes_finish(self):
        rows = json.loads(Path('dynatrace-hackathon-racing/ui/app/data/capture.json').read_text())
        lap = recorded_lap(rows)
        self.assertEqual(len(lap), 2081)
        self.assertEqual(lap[-1]['last_lap_s'], 104.015)
        self.assertEqual(lap[-1]['lap_number'], 2)
        replay = Replay(lap)
        replay.command('start')
        replay.tick(replay.next_at)
        self.assertEqual(len(replay.events), 1)
        replay.command('pause')
        replay.tick(replay.next_at + 1000)
        self.assertEqual(len(replay.events), 1)
        replay.command('resume')
        replay.tick(replay.next_at + 1000)
        self.assertFalse(replay.running)
        self.assertEqual(replay.events[-1]['last_lap_s'], 104.015)
        self.assertEqual(len(replay.snapshot(0, -1)['events']), 1000)
        replay.command('reset')
        self.assertEqual(replay.snapshot(2000, -1)['cursor'], 0)

if __name__ == '__main__':
    unittest.main()
