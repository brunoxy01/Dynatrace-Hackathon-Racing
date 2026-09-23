"""Build a reproducible UI replay and track from the original UDP capture.

Run from repository root: python prepare_capture.py
No network requests or ingestion. Recorded timestamps are preserved.
"""
import json
from pathlib import Path
from ams2_collector import Collector

ROOT = Path(__file__).resolve().parent
collector = Collector('rig-01', 'Simulador 1', 'capture-2026-09-19', 'real')
events = []
for line in (ROOT / 'captura.txt').read_text(encoding='utf-8').splitlines():
    timestamp, _, _, payload = line.split('\t')
    event = collector.handle_packet(bytes.fromhex(payload))
    if event:
        event['timestamp'] = timestamp
        events.append(event)

# A complete timed lap, excluding the initial out lap and the final stopped car.
lap = [e for e in events if e['lap_number'] == 1 and e['lap_time_s'] is not None]
points = []
for event in lap:
    point = [event['pos_x'], event['pos_y']]
    if not points or sum((a-b)**2 for a,b in zip(point, points[-1])) >= 8**2:
        points.append(point)

out = ROOT / 'dynatrace-hackathon-racing' / 'ui' / 'app' / 'data'
out.mkdir(parents=True, exist_ok=True)
# Preserve all samples so peak speed and spatial means remain exact.
sampled = events
(out / 'capture.json').write_text(json.dumps(sampled, separators=(',', ':')), encoding='utf-8')
(out / 'interlagos.json').write_text(json.dumps(points, separators=(',', ':')), encoding='utf-8')
print(f'{len(events)} events -> {len(sampled)} UI samples; {len(points)} track points')
