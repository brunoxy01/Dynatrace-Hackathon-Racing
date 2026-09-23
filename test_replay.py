import json
import unittest
from pathlib import Path
from replay_server import Replay, recorded_lap, demo_grid

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

    def test_demo_grid_has_four_distinct_participants(self):
        rows = json.loads(Path('dynatrace-hackathon-racing/ui/app/data/capture.json').read_text())
        grid = demo_grid(recorded_lap(rows))
        self.assertEqual(len(grid), 8324)
        self.assertEqual(len({r['rig.id'] for r in grid}), 4)
        self.assertEqual({r['company_name'] for r in grid if r['source'] == 'demo'}, {'Dynatrace', 'Bradesco', 'Caixa'})
        self.assertEqual(len({r['last_lap_s'] for r in grid if r.get('last_lap_s')}), 4)
        self.assertTrue(all(r.get('simulation') for r in grid if r['source'] == 'demo'))
        self.assertEqual([r['timestamp'] for r in grid], sorted(r['timestamp'] for r in grid))

if __name__ == '__main__':
    unittest.main()
