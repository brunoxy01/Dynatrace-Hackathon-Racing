#!/usr/bin/env python3
"""Endpoint OTLP falso para ensaiar o pipeline sem tocar no Dynatrace.

Faz o papel do `/api/v2/otlp/v1/logs`: aceita o POST do collector, conta os
registros e grava cada um como uma linha JSON plana - exatamente os campos que
viram atributos de topo no Grail. Assim da' para conferir nome e tipo de cada
campo antes de gastar ingestao.

    python3 otel/endpoint_falso.py [--port 4319] [--out recebido.jsonl]
"""

import argparse
import gzip
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


def _plain(value: dict):
    """AnyValue do OTLP -> valor Python."""
    for key in ("stringValue", "boolValue", "doubleValue"):
        if key in value:
            return value[key]
    if "intValue" in value:
        return int(value["intValue"])
    return value


class Handler(BaseHTTPRequestHandler):
    out_file = None
    total = 0

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        if self.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)

        records = []
        if self.headers.get("Content-Type", "").startswith("application/json"):
            payload = json.loads(raw)
            for resource in payload.get("resourceLogs", []):
                for scope in resource.get("scopeLogs", []):
                    for record in scope.get("logRecords", []):
                        flat = {a["key"]: _plain(a["value"]) for a in record.get("attributes", [])}
                        flat["_body"] = _plain(record.get("body", {}))
                        flat["_timeUnixNano"] = record.get("timeUnixNano")
                        records.append(flat)
        else:
            # protobuf: nao desserializa, so' contabiliza o recebimento
            records.append({"_protobuf_bytes": len(raw)})

        Handler.total += len(records)
        if Handler.out_file:
            for record in records:
                Handler.out_file.write(json.dumps(record, ensure_ascii=False) + "\n")
            Handler.out_file.flush()
        print(f"[endpoint-falso] +{len(records)} registro(s) | total {Handler.total} "
              f"| content-type {self.headers.get('Content-Type')}", flush=True)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *_args):
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4319)
    parser.add_argument("--out", default="recebido.jsonl")
    args = parser.parse_args()

    Handler.out_file = open(args.out, "w", encoding="utf-8", buffering=1)
    print(f"[endpoint-falso] ouvindo em http://127.0.0.1:{args.port} -> {args.out}")
    try:
        HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print(f"\n[endpoint-falso] encerrado com {Handler.total} registro(s)")


if __name__ == "__main__":
    main()
