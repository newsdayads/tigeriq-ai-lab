"""Run on Python 3.12: python tests/cli-anything-writer.test.py."""
import importlib.util
import pathlib
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
import hashlib

path = pathlib.Path(__file__).resolve().parents[1] / "apps/openclaw-tigeriq-runtime/cli-anything-writer.py"
spec = importlib.util.spec_from_file_location("writer_adapter", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class WriterAdapterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name).resolve()
        self.request = {"id": "sample-1", "title": "TigerIQ", "paragraphs": ["Ti\u1ebfng Vi\u1ec7t & <OK>"]}

    def tearDown(self):
        self.tmp.cleanup()

    def test_real_odt(self):
        result = m.run_request(self.request, self.root)
        p = pathlib.Path(result["path"])
        self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(), result["sha256"])
        with zipfile.ZipFile(p) as z:
            self.assertEqual(z.testzip(), None)
            self.assertEqual(z.namelist()[0], "mimetype")
            self.assertEqual(z.getinfo("mimetype").compress_type, zipfile.ZIP_STORED)
            self.assertEqual(z.read("mimetype"), b"application/vnd.oasis.opendocument.text")
            self.assertEqual(ET.fromstring(z.read("content.xml")).find(".//" + m._ns("text", "p")).text, self.request["paragraphs"][0])

    def test_no_overwrite(self):
        first = m.run_request(self.request, self.root)
        p = pathlib.Path(first["path"])
        before = p.read_bytes()
        with self.assertRaises(FileExistsError):
            m.run_request(self.request, self.root)
        self.assertEqual(p.read_bytes(), before)

    def test_bad_identifiers(self):
        for ident in ["../escape", "a/b", "C:\\\\temp", "nul", "com1", "", "A", "x"*65]:
            with self.subTest(ident=ident), self.assertRaises(ValueError):
                m.run_request({**self.request, "id": ident}, self.root)
        self.assertFalse(list(self.root.iterdir()))

    def test_invalid_inputs(self):
        for value in [None, [], {**self.request, "path": "elsewhere"}, {**self.request, "title": "\x00"}, {**self.request, "paragraphs": []}, {**self.request, "paragraphs": ["a"]*31}, {**self.request, "paragraphs": ["a"*2001]}]:
            with self.subTest(value=type(value)), self.assertRaises(ValueError):
                m.run_request(value, self.root)
        self.assertFalse(list(self.root.iterdir()))

    def test_missing_root(self):
        with self.assertRaises(ValueError):
            m.run_request(self.request, self.root / "missing")

    def test_carriage_return(self):
        m.run_request({**self.request, "paragraphs": ["a\r\nb\rc"]}, self.root)


if __name__ == "__main__":
    unittest.main()
