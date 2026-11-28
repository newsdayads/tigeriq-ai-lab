"""Audit TiG A1 candidate packages; never confer visual or release acceptance."""
import argparse
import hashlib
import io
import json
import struct
import zlib
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree


def require(condition, message):
    if not condition:
        raise ValueError(message)


def names(z):
    entries = z.namelist()
    require(len(entries) == len(set(entries)), 'duplicate archive entries')
    require(z.testzip() is None, 'ZIP CRC failure')
    return set(entries)


def validate_png_pixels(header, chunks):
    width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', header)
    depths = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
    require(color in depths and depth in depths[color], 'invalid PNG color/depth')
    require(compression == filtering == 0 and interlace in (0, 1), 'invalid PNG encoding')
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    passes = [(0, 0, 1, 1)] if not interlace else [
        (0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
        (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]
    layouts = []
    for x, y, dx, dy in passes:
        w = max(0, (width - x + dx - 1) // dx)
        h = max(0, (height - y + dy - 1) // dy)
        if w and h:
            layouts.append((1 + (w * channels * depth + 7) // 8, h))
    expected = sum(stride * rows for stride, rows in layouts)
    require(0 < expected <= 64 * 1024 * 1024, 'PNG decoded size exceeds audit limit')
    decoder = zlib.decompressobj()
    try:
        pixels = decoder.decompress(b''.join(chunks), expected + 1)
    except zlib.error as exc:
        raise ValueError('invalid PNG IDAT stream') from exc
    require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail
            and len(pixels) == expected, 'invalid PNG decoded size or stream ending')
    offset = 0
    for stride, rows in layouts:
        end = offset + stride * rows
        require(all(v <= 4 for v in pixels[offset:end:stride]), 'invalid PNG row filter')
        offset = end


def png_size(data):
    require(data[:8] == b"\x89PNG\r\n\x1a\n", 'invalid PNG signature')
    offset, dimensions, header, chunks = 8, None, None, []
    color = depth = None
    palette_seen = False
    idat_started = False
    idat_ended = False
    while offset + 12 <= len(data):
        length, kind = struct.unpack_from('>I4s', data, offset)
        end = offset + 12 + length
        require(end <= len(data), 'truncated PNG chunk')
        payload = data[offset + 8:end - 4]
        require(zlib.crc32(kind + payload) == struct.unpack_from('>I', data, end - 4)[0], 'PNG CRC failure')
        if kind == b'IHDR':
            require(offset == 8 and length == 13, 'duplicate or misplaced PNG IHDR')
        if kind not in (b'IHDR', b'PLTE', b'IDAT', b'IEND'):
            require(bool(kind[0] & 0x20), 'unsupported critical PNG chunk')
        if offset == 8:
            require(kind == b'IHDR' and length == 13, 'missing PNG IHDR')
            header = payload
            dimensions = struct.unpack_from('>II', payload)
            require(all(dimensions), 'invalid PNG dimensions')
            depth, color = header[8], header[9]
        if kind == b'PLTE':
            require(not idat_started and not palette_seen, 'invalid PNG PLTE ordering or duplicate')
            require(color in (2, 3, 6), 'PNG PLTE forbidden for grayscale color type')
            require(3 <= length <= 768 and length % 3 == 0, 'invalid PNG PLTE length')
            if color == 3:
                require(length // 3 <= 2 ** depth, 'PNG PLTE exceeds indexed bit depth')
            palette_seen = True
        elif kind == b'IDAT':
            require(not idat_ended, 'non-consecutive PNG IDAT chunks')
            if color == 3:
                require(palette_seen, 'missing PNG PLTE for indexed color')
            idat_started = True
            chunks.append(payload)
        elif idat_started and kind != b'IEND':
            idat_ended = True
        if kind == b'IEND':
            require(length == 0 and end == len(data) and chunks, 'invalid PNG ending')
            validate_png_pixels(header, chunks)
            return dimensions
        offset = end
    raise ValueError('missing PNG IEND')

def audit(path):
    with ZipFile(path) as z:
        entries = names(z)
        manifest = json.loads(z.read('manifest.json'))
        require(isinstance(manifest, dict), 'invalid manifest')
        require(set(manifest) == entries - {'manifest.json'}, 'manifest coverage mismatch')
        for name, digest in manifest.items():
            require(hashlib.sha256(z.read(name)).hexdigest() == digest, 'hash mismatch: ' + name)
        oras = [n for n in entries if n.endswith('.ora')]
        require(len(oras) == 1, 'expected one ORA candidate')
        with ZipFile(io.BytesIO(z.read(oras[0]))) as ora:
            inner = names(ora)
            require(ora.read('mimetype') == b'image/openraster', 'invalid ORA mimetype')
            root = ElementTree.fromstring(ora.read('stack.xml'))
            require(root.tag == 'image', 'invalid ORA root')
            width, height = int(root.attrib['w']), int(root.attrib['h'])
            require(width >= 432 and height >= 560, 'canvas below HQ minimum')
            layers = list(root.iter('layer'))
            ids = [l.attrib['name'] for l in layers]
            require(len(ids) >= 2 and len(ids) == len(set(ids)), 'missing or duplicate layer IDs')
            require(all(l.attrib['src'] in inner for l in layers), 'missing layer asset')
            require('mergedimage.png' in inner, 'missing composite')
            require(png_size(ora.read('mergedimage.png')) == (width, height), 'composite canvas mismatch')
            for layer in layers:
                png_size(ora.read(layer.attrib['src']))
        qa = json.loads(z.read('qa.json'))
        require(isinstance(qa, dict), 'invalid QA receipt')
        for key in ('ora_layers', 'output_layers'):
            if key in qa:
                require(qa[key] == len(layers), 'receipt layer count mismatch')
        for key in ('ora_sha256', 'output_ora_sha256'):
            if key in qa:
                require(qa[key] == manifest[oras[0]], 'receipt ORA hash mismatch')
        return {'technical_package_integrity': 'PASS', 'layers': len(layers),
                'manifest_hashes': len(manifest), 'canvas': [width, height],
                'visual_acceptance': 'NOT_VERIFIED_BY_THIS_TOOL',
                'release_authorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('--require-release', action='store_true')
    args = parser.parse_args()
    try:
        result = audit(args.package)
    except Exception as exc:
        print(json.dumps({'technical_package_integrity': 'FAIL', 'error': str(exc), 'release_authorized': False}))
        return 1
    print(json.dumps(result))
    return 2 if args.require_release else 0


if __name__ == '__main__':
    raise SystemExit(main())
