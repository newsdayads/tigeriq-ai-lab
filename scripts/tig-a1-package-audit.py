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


def png_size(data):
    require(data[:8] == b"\x89PNG\r\n\x1a\n", 'invalid PNG signature')
    offset, dimensions, seen_idat = 8, None, False
    while offset + 12 <= len(data):
        length, kind = struct.unpack_from('>I4s', data, offset)
        end = offset + 12 + length
        require(end <= len(data), 'truncated PNG chunk')
        payload = data[offset + 8:end - 4]
        require(zlib.crc32(kind + payload) == struct.unpack_from('>I', data, end - 4)[0], 'PNG CRC failure')
        if offset == 8:
            require(kind == b'IHDR' and length == 13, 'missing PNG IHDR')
            dimensions = struct.unpack_from('>II', payload)
            require(all(dimensions), 'invalid PNG dimensions')
        if kind == b'IDAT':
            seen_idat = True
        if kind == b'IEND':
            require(length == 0 and end == len(data) and seen_idat, 'invalid PNG ending')
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
