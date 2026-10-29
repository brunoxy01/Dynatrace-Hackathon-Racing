import json
import os
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

INI = (
    "[rig]\r\n"
    "rig_id = rig-01\r\n"
    "# Quem esta na cadeira.\r\n"
    "driver_name = Bruno Lima\r\n"
    "dt_api_token = segredo\r\n"
)


class IniTests(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.ini = Path(self.pasta.name) / "racing.ini"
        self.ini.write_bytes(INI.encode("utf-8"))

    def tearDown(self):
        self.pasta.cleanup()

    def test_name_is_written_keeping_the_rest_of_the_file(self):
        painel_piloto.gravar_driver_name(self.ini, "Ana Souza")
        self.assertEqual(INI.replace("Bruno Lima", "Ana Souza"), self.ini.read_bytes().decode("utf-8"))
        self.assertEqual("Ana Souza", painel_piloto.ler_driver_name(self.ini))

    def test_missing_key_is_added_under_rig(self):
        self.ini.write_text("[rig]\nrig_id = rig-01\n", encoding="utf-8")
        painel_piloto.gravar_driver_name(self.ini, "Ana")
        self.assertEqual("[rig]\ndriver_name = Ana\nrig_id = rig-01\n", self.ini.read_text(encoding="utf-8"))

    def test_bom_written_by_notepad_is_kept(self):
        self.ini.write_bytes(b"\xef\xbb\xbf" + INI.encode("utf-8"))
        painel_piloto.gravar_driver_name(self.ini, "Ana")
        self.assertTrue(self.ini.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertEqual("Ana", painel_piloto.ler_driver_name(self.ini))

    def test_names_that_would_break_the_ini_are_cleaned(self):
        self.assertEqual("Ana Souza", painel_piloto.limpar_nome("  Ana\n  Souza "))
        self.assertEqual("Ana 100", painel_piloto.limpar_nome("Ana 100%"))
        self.assertEqual("Joao", painel_piloto.limpar_nome("Joao;#="))
        self.assertEqual(40, len(painel_piloto.limpar_nome("x" * 80)))
        self.assertEqual("José Ção", painel_piloto.limpar_nome("José Ção"))

    def test_watcher_applies_a_new_name_once(self):
        aplicados = []
        vigia = painel_piloto.VigiaDoIni(self.ini, aplicados.append, "Bruno Lima")
        self.assertFalse(vigia.checar(), "arquivo sem mudanca")
        painel_piloto.gravar_driver_name(self.ini, "Ana")
        os.utime(self.ini, ns=(1, 2_000_000_000_000_000_000))  # garante mtime diferente
        self.assertTrue(vigia.checar())
        self.assertFalse(vigia.checar())
        self.assertEqual(["Ana"], aplicados)

    def test_watcher_blank_name_means_game_profile(self):
        aplicados = []
        vigia = painel_piloto.VigiaDoIni(self.ini, aplicados.append, "Bruno Lima")
        painel_piloto.gravar_driver_name(self.ini, "")
        os.utime(self.ini, ns=(1, 2_000_000_000_000_000_000))
        vigia.checar()
        self.assertEqual([None], aplicados)

    def test_watcher_ignores_a_file_without_the_key(self):
        aplicados = []
        vigia = painel_piloto.VigiaDoIni(self.ini, aplicados.append, "Bruno Lima")
        self.ini.write_text("[rig]\nrig_id = rig-01\n", encoding="utf-8")
        os.utime(self.ini, ns=(1, 2_000_000_000_000_000_000))
        self.assertFalse(vigia.checar())
        self.assertEqual([], aplicados)


class PainelTests(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.ini = Path(self.pasta.name) / "racing.ini"
        self.ini.write_bytes(INI.encode("utf-8"))
        self.coletor = Collector("rig-01", "Simulador 1", "live-1", "real", "Bruno Lima")
        self.url = painel_piloto.iniciar_painel(self.ini, self.coletor.estado, porta=0)

    def tearDown(self):
        self.pasta.cleanup()

    def _get(self, caminho=""):
        with urllib.request.urlopen(self.url + caminho, timeout=5) as resposta:
            return resposta.read().decode("utf-8")

    def _token(self):
        pagina = self._get()
        return pagina.split('name="token" value="')[1].split('"')[0]

    def _post(self, dados):
        pedido = urllib.request.Request(self.url + "piloto", data=urllib.parse.urlencode(dados).encode("utf-8"), method="POST")
        with urllib.request.urlopen(pedido, timeout=5) as resposta:
            return resposta.read().decode("utf-8")

    def test_page_shows_the_driver_and_a_form(self):
        self.assertTrue(self.url.startswith("http://127.0.0.1:"))
        pagina = self._get()
        self.assertIn("Bruno Lima", pagina)
        self.assertIn('action="/piloto"', pagina)
        self.assertIn("rig-01", pagina)

    def test_changing_the_driver_from_the_page_reaches_the_collector(self):
        vigia = painel_piloto.VigiaDoIni(self.ini, self.coletor.trocar_piloto, "Bruno Lima")
        pagina = self._post({"nome": "Ana Souza", "token": self._token()})
        self.assertIn("Piloto trocado para Ana Souza", pagina)
        self.assertEqual("Ana Souza", painel_piloto.ler_driver_name(self.ini))
        os.utime(self.ini, ns=(1, 2_000_000_000_000_000_000))
        vigia.checar()  # o que a thread da vigia faz a cada segundo
        self.assertEqual("Ana Souza", self.coletor.piloto_em_uso())
        estado = json.loads(self._get("estado"))
        self.assertEqual("Ana Souza", estado["piloto_em_uso"])
        self.assertIn("-p1", estado["sessao"])

    def test_form_without_the_page_token_is_refused(self):
        with self.assertRaises(urllib.error.HTTPError) as erro:
            self._post({"nome": "Intruso", "token": "errado"})
        self.assertEqual(403, erro.exception.code)
        self.assertEqual("Bruno Lima", painel_piloto.ler_driver_name(self.ini))

    def test_driver_name_is_html_escaped(self):
        self._post({"nome": "<script>x</script>", "token": self._token()})
        self.assertNotIn("<script>x</script>", self._get())


if __name__ == "__main__":
    unittest.main()
