"""Run on Python 3.12: python tests/cli-anything-writer.test.py."""
import hashlib
import io
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from unittest import mock

path = pathlib.Path(__file__).resolve().parents[1] / "apps/openclaw-tigeriq-runtime/cli-anything-writer.py"
spec = importlib.util.spec_from_file_location("writer_adapter", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class WriterAdapterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name).resolve()
        self.previous_root = m.ROOT
        m.ROOT = self.root
        self.request = {"id": "sample-1", "title": "TigerIQ", "paragraphs": ["Ti\u1ebfng Vi\u1ec7t & <OK>"]}

    def tearDown(self):
        m.ROOT = self.previous_root
        self.tmp.cleanup()

    def test_real_odt(self):
        result = m.run_request(self.request)
        p = pathlib.Path(result["path"])
        self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(), result["sha256"])
        with zipfile.ZipFile(p) as z:
            self.assertEqual(z.testzip(), None)
            self.assertEqual(z.namelist()[0], "mimetype")
            self.assertEqual(z.getinfo("mimetype").compress_type, zipfile.ZIP_STORED)
            self.assertEqual(z.read("mimetype"), b"application/vnd.oasis.opendocument.text")
            self.assertEqual(ET.fromstring(z.read("content.xml")).find(".//" + m._ns("text", "p")).text, self.request["paragraphs"][0])

    def test_no_overwrite(self):
        first = m.run_request(self.request)
        p = pathlib.Path(first["path"])
        before = p.read_bytes()
        with self.assertRaises(FileExistsError):
            m.run_request(self.request)
        self.assertEqual(p.read_bytes(), before)
        self.assertEqual(sorted(x.name for x in self.root.iterdir()), ["sample-1.odt"])

    def test_bad_identifiers(self):
        for ident in ["../escape", "a/b", "C:\\\\temp", "nul", "com1", "", "A", "x"*65]:
            with self.subTest(ident=ident), self.assertRaises(ValueError):
                m.run_request({**self.request, "id": ident})
        self.assertFalse(list(self.root.iterdir()))

    def test_invalid_inputs(self):
        for value in [None, [], {**self.request, "path": "elsewhere"}, {**self.request, "title": "\x00"}, {**self.request, "paragraphs": []}, {**self.request, "paragraphs": ["a"]*31}, {**self.request, "paragraphs": ["a"*2001]}]:
            with self.subTest(value=type(value)), self.assertRaises(ValueError):
                m.run_request(value)
        self.assertFalse(list(self.root.iterdir()))

    def test_missing_root(self):
        with mock.patch.object(m, "ROOT", self.root / "missing"):
            with self.assertRaises(ValueError):
                m.run_request(self.request)

    def test_carriage_return(self):
        m.run_request({**self.request, "paragraphs": ["a\r\nb\rc"]})

    def test_atomic_publish_failure_cleanup(self):
        with mock.patch.object(m.os, "link", side_effect=OSError("simulated publish failure")):
            with self.assertRaises(OSError):
                m.run_request(self.request)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_fsync_failure_cleanup(self):
        with mock.patch.object(m.os, "fsync", side_effect=OSError("simulated fsync failure")):
            with self.assertRaises(OSError):
                m.run_request(self.request)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_output_readback_failure_cleanup(self):
        original = pathlib.Path.read_bytes
        def fail_odt_read(path):
            if path.suffix == ".odt":
                raise OSError("simulated output readback failure")
            return original(path)
        with mock.patch.object(pathlib.Path, "read_bytes", fail_odt_read):
            with self.assertRaises(OSError):
                m.run_request(self.request)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_cli_success_path(self):
        raw = json.dumps(self.request).encode("utf-8")
        stdin = io.TextIOWrapper(io.BytesIO(raw), encoding="utf-8")
        stdout = io.StringIO()
        with mock.patch.object(m, "ROOT", self.root), mock.patch.object(m.sys, "stdin", stdin), mock.patch.object(m.sys, "stdout", stdout), mock.patch.object(m.sys, "argv", [str(path)]):
            self.assertEqual(m.main(), 0)
        receipt = json.loads(stdout.getvalue())
        self.assertTrue(receipt["ok"])
        self.assertEqual(pathlib.Path(receipt["path"]).read_bytes()[:2], b"PK")

    def test_public_api_does_not_accept_output_path(self):
        with self.assertRaises(TypeError):
            m.run_request(self.request, self.root)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_cli_rejects_duplicate_json_keys(self):
        result = subprocess.run([sys.executable, str(path)], input=b'{"id":"one","id":"two","title":"T","paragraphs":["p"]}', capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {"ok": False, "error": "DUPLICATE_KEY"})

    def test_cli_rejects_oversized_input(self):
        result = subprocess.run([sys.executable, str(path)], input=b"x" * (m.MAX_INPUT + 1), capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {"ok": False, "error": "INPUT_SIZE_INVALID"})

    def test_cli_rejects_arguments(self):
        result = subprocess.run([sys.executable, str(path), "--output", "elsewhere"], input=b"{}", capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {"ok": False, "error": "NO_ARGUMENTS_ALLOWED"})


if __name__ == "__main__":
    unittest.main()
