import http.client
import json
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "rig"))

import painel_piloto  # noqa: E402
from ams2_collector import Collector  # noqa: E402


class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ArquivoTests(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.arquivo = Path(self.pasta.name) / painel_piloto.ARQUIVO

    def tearDown(self):
        self.pasta.cleanup()

    def test_last_choice_survives_a_restart(self):
        painel_piloto.salvar_piloto(self.arquivo, "Ana Souza", "Itaú")
        self.assertEqual(("Ana Souza", "Itaú"), painel_piloto.ler_piloto_salvo(self.arquivo))

    def test_missing_or_broken_file_means_no_driver(self):
        self.assertEqual((None, None), painel_piloto.ler_piloto_salvo(self.arquivo))
        self.arquivo.write_text("{quebrado", encoding="utf-8")
        self.assertEqual((None, None), painel_piloto.ler_piloto_salvo(self.arquivo))

    def test_names_are_one_short_line(self):
        self.assertEqual("Ana Souza", painel_piloto.limpar("  Ana\n\t Souza "))
        self.assertEqual(painel_piloto.LIMITE, len(painel_piloto.limpar("x" * 80)))
        self.assertIsNone(painel_piloto.limpar("   "))


class TelaTests(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.arquivo = Path(self.pasta.name) / painel_piloto.ARQUIVO
        self.coletor = Collector("rig-01", "Simulador 1", "live-1", "real", "Ana", 0.0, "Itau")
        self.url = painel_piloto.iniciar_painel(self.arquivo, self.coletor.estado, self.coletor.definir_piloto, porta=0)

    def tearDown(self):
        self.pasta.cleanup()

    def _get(self, caminho=""):
        with urllib.request.urlopen(self.url + caminho, timeout=5) as resposta:
            return resposta.read()

    def _token(self):
        return self._get().decode("utf-8").split('name="token" value="')[1].split('"')[0]

    def _post(self, dados):
        pedido = urllib.request.Request(self.url + "piloto", data=urllib.parse.urlencode(dados).encode("utf-8"),
                                        method="POST")
        return urllib.request.build_opener(_SemRedirecionar).open(pedido, timeout=5)

    def test_page_has_the_two_fields_logo_and_no_simulator(self):
        self.assertTrue(self.url.startswith("http://127.0.0.1:"))
        pagina = self._get().decode("utf-8")
        for trecho in ('name="nome"', 'name="empresa"', 'src="/logo.png"', "Dynatrace Racing", "Ana", "Itau"):
            self.assertIn(trecho, pagina)
        self.assertNotIn("rig-01", pagina)
        self.assertNotIn("Simulador", pagina)
        self.assertTrue(self._get("logo.png").startswith(b"\x89PNG"))

    def test_choice_is_saved_and_reaches_the_collector_without_restart(self):
        with self.assertRaises(urllib.error.HTTPError) as resposta:
            self._post({"nome": "Bruno", "empresa": "Dynatrace", "token": self._token()})
        self.assertEqual(303, resposta.exception.code)
        self.assertEqual(("Bruno", "Dynatrace"), painel_piloto.ler_piloto_salvo(self.arquivo))
        estado = json.loads(self._get("estado"))
        self.assertEqual({"piloto": "Bruno", "empresa": "Dynatrace"}, estado["proximo"])
        self.assertEqual("Ana", estado["piloto"], "so' troca quando a volta comecar")
        self.assertIn("Bruno · Dynatrace", self._get("?ok=1").decode("utf-8"))

    def test_form_without_the_page_token_is_refused(self):
        with self.assertRaises(urllib.error.HTTPError) as erro:
            self._post({"nome": "Intruso", "empresa": "X", "token": "errado"})
        self.assertEqual(403, erro.exception.code)
        self.assertIsNone(self.coletor.estado()["proximo"])

    def test_other_host_names_are_refused(self):
        porta = urllib.parse.urlsplit(self.url).port
        conexao = http.client.HTTPConnection("127.0.0.1", porta, timeout=5)
        conexao.request("GET", "/estado", headers={"Host": f"site-malicioso.com:{porta}"})
        self.assertEqual(403, conexao.getresponse().status)

    def test_names_are_html_escaped(self):
        with self.assertRaises(urllib.error.HTTPError):
            self._post({"nome": "<script>x</script>", "empresa": "Y", "token": self._token()})
        self.assertNotIn("<script>x</script>", self._get().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
