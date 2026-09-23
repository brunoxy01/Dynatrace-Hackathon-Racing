"""Local event generator for the Racing preview. No Dynatrace ingestion.

python replay_server.py --port 3001 --speed 1
Starts idle; use 'Iniciar simulação' in the app to emit the recorded timed lap.
Only listens on loopback. The original 20 Hz timestamps determine playback timing.
"""
import argparse
import json
import threading
import time
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


class Replay:
    def __init__(self, source, speed=1.0):
        self.source = source
        self.speed = speed
        self.lock = threading.Lock()
        self.events = []
        self.generation = 0
        self.cursor = 0
        self.running = False
        self.next_at = 0.0

    def command(self, action):
        with self.lock:
            if action in ('start', 'reset'):
                self.generation += 1
                self.events = []
                self.cursor = 0
            if action in ('start', 'resume'):
                self.running = self.cursor < len(self.source)
                self.next_at = time.monotonic()
            else:
                self.running = False

    def tick(self, clock):
        with self.lock:
            while self.running and clock >= self.next_at:
                current = self.source[self.cursor]
                event = dict(current)
                event['recorded.timestamp'] = event['timestamp']
                event['timestamp'] = datetime.now(timezone.utc).isoformat()
                event['session.id'] = f'local-replay-{self.generation}'
                event['source'] = current.get('source', 'replay')
                self.events.append(event)
                self.cursor += 1
                if self.cursor >= len(self.source):
                    self.running = False
                    break
                next_time = datetime.fromisoformat(self.source[self.cursor]['timestamp'])
                this_time = datetime.fromisoformat(current['timestamp'])
                self.next_at += max(0.001, (next_time-this_time).total_seconds()) / self.speed

    def snapshot(self, after, generation):
        with self.lock:
            offset = after if generation == self.generation else 0
            offset = min(max(0, offset), len(self.events))
            chunk = self.events[offset:offset+1000]
            return {'generation': self.generation, 'cursor': offset+len(chunk),
                    'events': chunk, 'running': self.running, 'total': len(self.source),
                    'emitted': len(self.events), 'speed': self.speed}


def make_handler(replay, allowed_origin):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, payload):
            data = json.dumps(payload, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Access-Control-Allow-Origin', allowed_origin)
            self.send_header('Vary', 'Origin')
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            if self.headers.get('Origin') != allowed_origin:
                return self.reply(403, {'error': 'Origin not allowed'})
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', allowed_origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, x-dt-app-dev-server-session-token')
            self.end_headers()

        def do_GET(self):
            url = urlparse(self.path)
            if url.path != '/events':
                return self.reply(404, {'error': 'Not found'})
            try:
                query = parse_qs(url.query)
                after = int(query.get('after', ['0'])[0])
                generation = int(query.get('generation', ['-1'])[0])
            except ValueError:
                return self.reply(400, {'error': 'Invalid cursor'})
            self.reply(200, replay.snapshot(after, generation))

        def do_POST(self):
            if self.headers.get('Origin') != allowed_origin:
                return self.reply(403, {'error': 'Origin not allowed'})
            action = self.path.removeprefix('/')
            if action not in ('start', 'pause', 'resume', 'reset'):
                return self.reply(404, {'error': 'Unknown command'})
            replay.command(action)
            self.reply(200, {'ok': True})

        def log_message(self, *_args):
            pass
    return Handler


def recorded_lap(records):
    """Include the timing confirmation after crossing the finish line."""
    start = next((i for i, r in enumerate(records) if r.get('lap_number') == 1 and r.get('lap_time_s') is not None), None)
    if start is None:
        return []
    end = next((i for i in range(start + 1, len(records)) if records[i].get('lap_number') == 2 and records[i].get('last_lap_s')), len(records) - 1)
    return records[start:end + 1]


def demo_grid(lap):
    """Original replay plus three explicitly synthetic participants on the same route."""
    result = [{**r, 'source': 'replay'} for r in lap]
    origin = datetime.fromisoformat(lap[0]['timestamp'])
    profiles = [('Bruno Lima', 'Dynatrace', 1.02, 0), ('Joãozinho', 'Bradesco', .98, 2), ('Agnes', 'Caixa', 1.04, 4)]
    for index, (name, company, pace, delay) in enumerate(profiles, 2):
        for row in lap:
            event = dict(row)
            elapsed = (datetime.fromisoformat(row['timestamp']) - origin).total_seconds()
            event.update({'timestamp': (origin + timedelta(seconds=elapsed * pace + delay)).isoformat(),
                          'driver_name': name, 'company_name': company, 'rig.id': f'demo-{index:02}',
                          'source': 'demo', 'simulation': True})
            for field in ('lap_time_s', 'last_lap_s', 'best_lap_s'):
                if event.get(field) is not None:
                    event[field] = round(event[field] * pace, 3)
            if event.get('speed_kmh') is not None:
                event['speed_kmh'] = round(event['speed_kmh'] / pace, 3)
            if event.get('acceleration_g') is not None:
                event['acceleration_g'] = round(event['acceleration_g'] / pace ** 2, 3)
            result.append(event)
    return sorted(result, key=lambda r: r['timestamp'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=3001)
    parser.add_argument('--speed', type=float, default=1)
    parser.add_argument('--recorded-only', action='store_true', help='Only the original captured participant; no synthetic companies')
    args = parser.parse_args()
    if not 0 < args.speed <= 20:
        parser.error('--speed must be between 0 and 20')
    path = Path(__file__).parent / 'dynatrace-hackathon-racing/ui/app/data/capture.json'
    records = json.loads(path.read_text(encoding='utf-8'))
    lap = recorded_lap(records)
    if not lap:
        raise SystemExit('Run python prepare_capture.py first: timed lap not found')
    source = lap if args.recorded_only else demo_grid(lap)
    replay = Replay(source, args.speed)
    stopping = threading.Event()
    def produce():
        while not stopping.wait(.01):
            replay.tick(time.monotonic())
    threading.Thread(target=produce, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(replay, 'http://localhost:3000'))
    print(f'Replay local pronto em http://localhost:{args.port}; {len(source)} amostras; {args.speed}x; aguardando Iniciar simulação.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stopping.set()
        server.server_close()


if __name__ == '__main__':
    main()
