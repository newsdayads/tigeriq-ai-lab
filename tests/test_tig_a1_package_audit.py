import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from zipfile import ZipFile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'tig-a1-package-audit.py'
if not SCRIPT.exists():
    SCRIPT = Path(__file__).with_name('tig-a1-package-audit-v2.py')
spec = importlib.util.spec_from_file_location('audit', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def png(w, h, idat=None, color_type=6, bit_depth=8, palette=None, palette_after_idat=False):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    row_bytes = (w * channels * bit_depth + 7) // 8
    compressed = zlib.compress((b'\0' * (1 + row_bytes)) * h) if idat is None else idat
    parts = [b'\x89PNG\r\n\x1a\n', chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, bit_depth, color_type, 0, 0, 0))]
    if palette is not None and not palette_after_idat:
        parts.append(chunk(b'PLTE', palette))
    parts.append(chunk(b'IDAT', compressed))
    if palette is not None and palette_after_idat:
        parts.append(chunk(b'PLTE', palette))
    parts.append(chunk(b'IEND', b''))
    return b''.join(parts)

class PackageTests(unittest.TestCase):
    def run_fixture(self, layer=None, composite=None, qa=None, require_release=False):
        with tempfile.TemporaryDirectory() as folder:
            ora = io.BytesIO()
            with ZipFile(ora, 'w') as z:
                z.writestr('mimetype', 'image/openraster')
                z.writestr('stack.xml', '<image w="432" h="560"><stack><layer name="body" src="data/body.png"/><layer name="head" src="data/head.png"/></stack></image>')
                z.writestr('data/body.png', png(1, 1) if layer is None else layer)
                z.writestr('data/head.png', png(1, 1))
                z.writestr('mergedimage.png', png(432, 560) if composite is None else composite)
            entries = {'candidate.ora': ora.getvalue(), 'qa.json': json.dumps({'ora_layers': 2} if qa is None else qa).encode()}
            path = Path(folder) / 'fixture.zip'
            with ZipFile(path, 'w') as z:
                for name, data in entries.items():
                    z.writestr(name, data)
                z.writestr('manifest.json', json.dumps({n: hashlib.sha256(d).hexdigest() for n, d in entries.items()}))
            if require_release:
                return subprocess.run([sys.executable, str(SCRIPT), str(path), '--require-release'],
                                      capture_output=True, text=True, check=False)
            return module.audit(path)

    def test_valid_never_grants_release(self):
        result = self.run_fixture()
        self.assertEqual(result['technical_package_integrity'], 'PASS')
        self.assertFalse(result['release_authorized'])
        self.assertEqual(result['visual_acceptance'], 'NOT_VERIFIED_BY_THIS_TOOL')

    def test_cli_refuses_release_of_technical_pass(self):
        result = self.run_fixture(require_release=True)
        self.assertEqual(result.returncode, 2, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['technical_package_integrity'], 'PASS')
        self.assertFalse(receipt['release_authorized'])
        self.assertEqual(receipt['visual_acceptance'], 'NOT_VERIFIED_BY_THIS_TOOL')

    def test_fake_layer_rejected_even_with_valid_hash(self):
        with self.assertRaisesRegex(ValueError, 'PNG signature'):
            self.run_fixture(layer=b'not an image')

    def test_png_crc_rejected(self):
        damaged = bytearray(png(1, 1))
        damaged[-1] ^= 1
        with self.assertRaisesRegex(ValueError, 'PNG CRC'):
            self.run_fixture(layer=bytes(damaged))

    def test_truncated_png_rejected(self):
        with self.assertRaisesRegex(ValueError, 'PNG IEND'):
            self.run_fixture(layer=png(1, 1)[:-12])

    def test_invalid_idat_rejected_with_valid_crc_and_hash(self):
        with self.assertRaisesRegex(ValueError, 'PNG IDAT stream'):
            self.run_fixture(layer=png(1, 1, b'not-zlib'))

    def test_wrong_decoded_size_rejected(self):
        with self.assertRaisesRegex(ValueError, 'PNG decoded size'):
            self.run_fixture(layer=png(1, 1, zlib.compress(b'\0' * 6)))

    def test_invalid_row_filter_rejected(self):
        with self.assertRaisesRegex(ValueError, 'PNG row filter'):
            self.run_fixture(layer=png(1, 1, zlib.compress(b'\x05' + b'\0' * 4)))

    def test_trailing_compressed_data_rejected(self):
        with self.assertRaisesRegex(ValueError, 'PNG decoded size'):
            self.run_fixture(layer=png(1, 1, zlib.compress(b'\0' * 5) + b'extra'))

    def test_indexed_png_requires_palette(self):
        with self.assertRaisesRegex(ValueError, 'missing PNG PLTE'):
            self.run_fixture(layer=png(1, 1, color_type=3))

    def test_indexed_png_accepts_valid_palette(self):
        result = self.run_fixture(layer=png(1, 1, color_type=3, palette=b'\xff\x00\x00'))
        self.assertEqual(result['technical_package_integrity'], 'PASS')

    def test_palette_forbidden_for_grayscale(self):
        with self.assertRaisesRegex(ValueError, 'PLTE forbidden'):
            self.run_fixture(layer=png(1, 1, color_type=0, palette=b'\x00\x00\x00'))

    def test_palette_must_precede_idat(self):
        with self.assertRaisesRegex(ValueError, 'missing PNG PLTE'):
            self.run_fixture(layer=png(1, 1, color_type=3, palette=b'\x00\x00\x00', palette_after_idat=True))

    def test_palette_length_must_be_rgb_triplets(self):
        with self.assertRaisesRegex(ValueError, 'PLTE length'):
            self.run_fixture(layer=png(1, 1, color_type=3, palette=b'\x00\x00'))

    def test_palette_entry_count_cannot_exceed_index_bit_depth(self):
        with self.assertRaisesRegex(ValueError, 'PLTE exceeds indexed bit depth'):
            self.run_fixture(layer=png(1, 1, color_type=3, bit_depth=1, palette=b'\x00\x00\x00' * 3))

    def test_wrong_composite_size(self):
        with self.assertRaisesRegex(ValueError, 'canvas mismatch'):
            self.run_fixture(composite=png(1, 1))

    def test_wrong_layer_count(self):
        with self.assertRaisesRegex(ValueError, 'layer count mismatch'):
            self.run_fixture(qa={'ora_layers': 9})


if __name__ == '__main__':
    unittest.main()
