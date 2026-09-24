import json
from datetime import datetime
import unittest

from ams2_collector import build_otlp_payload, split_driver_company


class SplitDriverCompanyTests(unittest.TestCase):
    def test_bracket_forms_all_yield_name_and_company(self):
        for texto in ("Bruno Lima [Dynatrace]", "[Bruno Lima][Dynatrace]", "[Bruno Lima] [Dynatrace]"):
            self.assertEqual(("Bruno Lima", "Dynatrace"), split_driver_company(texto), texto)

    def test_company_names_may_contain_spaces(self):
        self.assertEqual(("Joao", "Bradesco Seguros"), split_driver_company("Joao [Bradesco Seguros]"))

    def test_plain_name_keeps_name_and_has_no_company(self):
        self.assertEqual(("fehspfc9", None), split_driver_company("fehspfc9"))
        self.assertEqual(("Bruno Lima", None), split_driver_company("[Bruno Lima]"))

    def test_empty_input_never_invents_a_driver(self):
        self.assertEqual((None, None), split_driver_company(None))
        self.assertEqual((None, None), split_driver_company("   "))
        self.assertEqual((None, None), split_driver_company("[]"))


class OtlpPayloadTests(unittest.TestCase):
    evento = {
        "timestamp": "2026-09-19T00:00:00+00:00",
        "sample.id": "rig-01|s1|7",
        "driver_name": "Bruno Lima",
        "company_name": "Dynatrace",
        "speed_kmh": 213.4,
        "gear": 5,
        "lap_invalidated": False,
        "best_lap_s": None,
    }

    def _atributos(self) -> dict:
        registro = build_otlp_payload([self.evento])["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]
        return {a["key"]: a["value"] for a in registro["attributes"]}

    def test_every_field_is_a_flat_scalar_attribute(self):
        """Campos planos chegam ao Grail como atributo de topo com o mesmo nome
        do bizevent, identico nos modelos raw e flattened."""
        atributos = self._atributos()
        self.assertEqual({"stringValue": "Bruno Lima"}, atributos["driver_name"])
        self.assertEqual({"stringValue": "Dynatrace"}, atributos["company_name"])
        self.assertEqual({"doubleValue": 213.4}, atributos["speed_kmh"])
        self.assertEqual({"intValue": "5"}, atributos["gear"])
        self.assertEqual({"boolValue": False}, atributos["lap_invalidated"])

    def test_bool_is_not_serialized_as_an_integer(self):
        # bool e' subclasse de int em Python; a ordem do isinstance importa.
        self.assertNotIn("intValue", self._atributos()["lap_invalidated"])

    def test_null_fields_are_omitted_instead_of_sent_as_empty(self):
        self.assertNotIn("best_lap_s", self._atributos())

    def test_timestamp_travels_in_the_record_time_not_as_an_attribute(self):
        registro = build_otlp_payload([self.evento])["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]
        esperado = int(datetime.fromisoformat(self.evento["timestamp"]).timestamp() * 1_000_000_000)
        self.assertNotIn("timestamp", self._atributos())
        self.assertEqual(str(esperado), registro["timeUnixNano"])
        self.assertEqual(registro["timeUnixNano"], registro["observedTimeUnixNano"])

    def test_payload_is_serializable_as_json(self):
        json.dumps(build_otlp_payload([self.evento]))


if __name__ == "__main__":
    unittest.main()
