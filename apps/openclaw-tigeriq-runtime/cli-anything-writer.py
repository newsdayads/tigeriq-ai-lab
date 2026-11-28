# Adapted from HKUDS/CLI-Anything odf_utils.py, blob 59a50348b33c878dec576f4e8d6b7591d0a420d5.
# Copyright 2026 HKUDS CLI-Anything Team; Apache-2.0. Modified: writer-only, no imports/parser or arbitrary path.
# License: docs/integrations/cli-anything-LICENSE.txt.
"""LibreOffice CLI - ODF XML helpers.

ODF (Open Document Format) files are ZIP archives containing XML files.
This module provides utilities for creating, parsing, and writing ODF documents.

Key ODF structure:
  mimetype          - MIME type (stored uncompressed, first entry)
  content.xml       - Document content
  styles.xml        - Document styles
  meta.xml          - Metadata
  META-INF/manifest.xml - Manifest of all files in the archive
"""

import os
import zipfile
import xml.etree.ElementTree as ET
from typing import Dict, Any, Optional
from datetime import datetime


# ODF XML Namespaces
ODF_NS = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "style": "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
    "fo": "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
    "draw": "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
    "presentation": "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0",
    "svg": "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0",
    "meta": "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
    "dc": "http://purl.org/dc/elements/1.1/",
    "manifest": "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
    "number": "urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0",
    "xlink": "http://www.w3.org/1999/xlink",
}

# MIME types for ODF document types
ODF_MIMETYPES = {
    "writer": "application/vnd.oasis.opendocument.text",
    "calc": "application/vnd.oasis.opendocument.spreadsheet",
    "impress": "application/vnd.oasis.opendocument.presentation",
}

# File extensions for ODF document types
ODF_EXTENSIONS = {
    "writer": ".odt",
    "calc": ".ods",
    "impress": ".odp",
}


def _register_namespaces():
    """Register all ODF namespaces with ElementTree to preserve prefixes."""
    for prefix, uri in ODF_NS.items():
        ET.register_namespace(prefix, uri)

def _ns(prefix: str, local: str) -> str:
    """Create a fully-qualified XML element name."""
    return f"{{{ODF_NS[prefix]}}}{local}"

def _nsattr(prefix: str, local: str) -> str:
    """Create a fully-qualified XML attribute name."""
    return f"{{{ODF_NS[prefix]}}}{local}"

def create_content_xml(doc_type: str, project: Dict[str, Any]) -> str:
    """Create content.xml for an ODF document from a project dict."""
    _register_namespaces()

    # Root element
    root = ET.Element(_ns("office", "document-content"))
    root.set(_nsattr("office", "version"), "1.2")

    # Automatic styles
    auto_styles = ET.SubElement(root, _ns("office", "automatic-styles"))

    if doc_type == "writer":
        _build_writer_content(root, auto_styles, project)
    else:
        raise ValueError('WRITER_ONLY')

    return _xml_to_string(root)

def _build_writer_content(root: ET.Element, auto_styles: ET.Element,
                          project: Dict[str, Any]) -> None:
    """Build Writer content.xml body."""
    body = ET.SubElement(root, _ns("office", "body"))
    text_elem = ET.SubElement(body, _ns("office", "text"))

    content_items = project.get("content", [])
    style_counter = [0]

    for item in content_items:
        item_type = item.get("type", "paragraph")

        if item_type == "heading":
            _add_heading_element(text_elem, auto_styles, item, style_counter)
        elif item_type == "paragraph":
            _add_paragraph_element(text_elem, auto_styles, item, style_counter)
        else:
            raise ValueError('UNSUPPORTED_CONTENT')

def _add_heading_element(parent: ET.Element, auto_styles: ET.Element,
                         item: Dict, style_counter: list) -> None:
    """Add a heading element to the content."""
    heading = ET.SubElement(parent, _ns("text", "h"))
    heading.set(_nsattr("text", "outline-level"), str(item.get("level", 1)))
    style = item.get("style", {})

    if style:
        style_name = f"H_auto{style_counter[0]}"
        style_counter[0] += 1
        heading.set(_nsattr("text", "style-name"), style_name)
        _create_text_auto_style(auto_styles, style_name, style, parent_style="Heading")
    heading.text = item.get("text", "")

def _add_paragraph_element(parent: ET.Element, auto_styles: ET.Element,
                           item: Dict, style_counter: list) -> None:
    """Add a paragraph element to the content."""
    para = ET.SubElement(parent, _ns("text", "p"))
    style = item.get("style", {})

    if style:
        style_name = f"P_auto{style_counter[0]}"
        style_counter[0] += 1
        para.set(_nsattr("text", "style-name"), style_name)
        _create_text_auto_style(auto_styles, style_name, style)

    text = item.get("text", "")

    # Handle styled spans within text
    spans = item.get("spans", [])
    if spans:
        last_end = 0
        for span_info in spans:
            start = span_info.get("start", 0)
            end = span_info.get("end", len(text))
            span_style = span_info.get("style", {})

            # Text before span
            if start > last_end:
                if para.text is None:
                    para.text = text[last_end:start]
                else:
                    # Add as tail of last sub-element
                    children = list(para)
                    if children:
                        if children[-1].tail is None:
                            children[-1].tail = text[last_end:start]
                        else:
                            children[-1].tail += text[last_end:start]
                    else:
                        para.text = (para.text or "") + text[last_end:start]

            # Span element
            span_style_name = f"S_auto{style_counter[0]}"
            style_counter[0] += 1
            span = ET.SubElement(para, _ns("text", "span"))
            span.set(_nsattr("text", "style-name"), span_style_name)
            span.text = text[start:end]
            _create_char_auto_style(auto_styles, span_style_name, span_style)

            last_end = end

        # Text after last span
        if last_end < len(text):
            children = list(para)
            if children:
                if children[-1].tail is None:
                    children[-1].tail = text[last_end:]
                else:
                    children[-1].tail += text[last_end:]
            else:
                para.text = (para.text or "") + text[last_end:]
    else:
        para.text = text

def _create_text_auto_style(auto_styles: ET.Element, name: str,
                            style: Dict, parent_style: str = "Standard") -> None:
    """Create an automatic paragraph style."""
    style_el = ET.SubElement(auto_styles, _ns("style", "style"))
    style_el.set(_nsattr("style", "name"), name)
    style_el.set(_nsattr("style", "family"), "paragraph")

    # Text properties
    tp = ET.SubElement(style_el, _ns("style", "text-properties"))
    if "font_size" in style:
        tp.set(_nsattr("fo", "font-size"), str(style["font_size"]))
    if "font_name" in style:
        tp.set(_nsattr("fo", "font-family"), str(style["font_name"]))
    if style.get("bold"):
        tp.set(_nsattr("fo", "font-weight"), "bold")
    if style.get("italic"):
        tp.set(_nsattr("fo", "font-style"), "italic")
    if style.get("underline"):
        tp.set(_nsattr("style", "text-underline-style"), "solid")
        tp.set(_nsattr("style", "text-underline-width"), "auto")
    if "color" in style:
        tp.set(_nsattr("fo", "color"), str(style["color"]))

    # Paragraph properties
    pp = ET.SubElement(style_el, _ns("style", "paragraph-properties"))
    if "alignment" in style:
        pp.set(_nsattr("fo", "text-align"), str(style["alignment"]))

def _create_char_auto_style(auto_styles: ET.Element, name: str,
                            style: Dict) -> None:
    """Create an automatic character style for spans."""
    style_el = ET.SubElement(auto_styles, _ns("style", "style"))
    style_el.set(_nsattr("style", "name"), name)
    style_el.set(_nsattr("style", "family"), "text")

    tp = ET.SubElement(style_el, _ns("style", "text-properties"))
    if "font_size" in style:
        tp.set(_nsattr("fo", "font-size"), str(style["font_size"]))
    if "font_name" in style:
        tp.set(_nsattr("fo", "font-family"), str(style["font_name"]))
    if style.get("bold"):
        tp.set(_nsattr("fo", "font-weight"), "bold")
    if style.get("italic"):
        tp.set(_nsattr("fo", "font-style"), "italic")
    if style.get("underline"):
        tp.set(_nsattr("style", "text-underline-style"), "solid")
        tp.set(_nsattr("style", "text-underline-width"), "auto")
    if "color" in style:
        tp.set(_nsattr("fo", "color"), str(style["color"]))

def create_styles_xml(doc_type: str, project: Dict[str, Any]) -> str:
    """Create styles.xml for an ODF document."""
    _register_namespaces()

    root = ET.Element(_ns("office", "document-styles"))
    root.set(_nsattr("office", "version"), "1.2")

    styles = ET.SubElement(root, _ns("office", "styles"))

    # Default paragraph style
    default_style = ET.SubElement(styles, _ns("style", "default-style"))
    default_style.set(_nsattr("style", "family"), "paragraph")
    tp = ET.SubElement(default_style, _ns("style", "text-properties"))
    tp.set(_nsattr("fo", "font-size"), "12pt")
    tp.set(_nsattr("fo", "font-family"), "Liberation Serif")

    # User-defined styles
    user_styles = project.get("styles", {})
    for style_name, style_def in user_styles.items():
        family = style_def.get("family", "paragraph")
        style_el = ET.SubElement(styles, _ns("style", "style"))
        style_el.set(_nsattr("style", "name"), style_name)
        style_el.set(_nsattr("style", "family"), family)
        if "parent" in style_def:
            style_el.set(_nsattr("style", "parent-style-name"), style_def["parent"])

        props = style_def.get("properties", {})
        if family == "paragraph":
            tp = ET.SubElement(style_el, _ns("style", "text-properties"))
            _apply_text_properties(tp, props)
            pp = ET.SubElement(style_el, _ns("style", "paragraph-properties"))
            _apply_paragraph_properties(pp, props)
        elif family == "text":
            tp = ET.SubElement(style_el, _ns("style", "text-properties"))
            _apply_text_properties(tp, props)

    # Automatic styles
    auto_styles = ET.SubElement(root, _ns("office", "automatic-styles"))

    # Page layout for writer
    if doc_type == "writer":
        settings = project.get("settings", {})
        pl = ET.SubElement(auto_styles, _ns("style", "page-layout"))
        pl.set(_nsattr("style", "name"), "PM1")
        plp = ET.SubElement(pl, _ns("style", "page-layout-properties"))
        plp.set(_nsattr("fo", "page-width"), settings.get("page_width", "21cm"))
        plp.set(_nsattr("fo", "page-height"), settings.get("page_height", "29.7cm"))
        plp.set(_nsattr("fo", "margin-top"), settings.get("margin_top", "2cm"))
        plp.set(_nsattr("fo", "margin-bottom"), settings.get("margin_bottom", "2cm"))
        plp.set(_nsattr("fo", "margin-left"), settings.get("margin_left", "2cm"))
        plp.set(_nsattr("fo", "margin-right"), settings.get("margin_right", "2cm"))

    # Master styles
    master_styles = ET.SubElement(root, _ns("office", "master-styles"))
    mp = ET.SubElement(master_styles, _ns("style", "master-page"))
    mp.set(_nsattr("style", "name"), "Default")
    if doc_type == "writer":
        mp.set(_nsattr("style", "page-layout-name"), "PM1")

    return _xml_to_string(root)

def _apply_text_properties(tp: ET.Element, props: Dict) -> None:
    """Apply text properties from a style dict to an XML element."""
    if "font_size" in props:
        tp.set(_nsattr("fo", "font-size"), str(props["font_size"]))
    if "font_name" in props:
        tp.set(_nsattr("fo", "font-family"), str(props["font_name"]))
    if props.get("bold"):
        tp.set(_nsattr("fo", "font-weight"), "bold")
    if props.get("italic"):
        tp.set(_nsattr("fo", "font-style"), "italic")
    if props.get("underline"):
        tp.set(_nsattr("style", "text-underline-style"), "solid")
    if "color" in props:
        tp.set(_nsattr("fo", "color"), str(props["color"]))

def _apply_paragraph_properties(pp: ET.Element, props: Dict) -> None:
    """Apply paragraph properties from a style dict to an XML element."""
    if "alignment" in props:
        pp.set(_nsattr("fo", "text-align"), str(props["alignment"]))
    if "line_height" in props:
        pp.set(_nsattr("fo", "line-height"), str(props["line_height"]))
    if "margin_top" in props:
        pp.set(_nsattr("fo", "margin-top"), str(props["margin_top"]))
    if "margin_bottom" in props:
        pp.set(_nsattr("fo", "margin-bottom"), str(props["margin_bottom"]))

def create_meta_xml(project: Dict[str, Any]) -> str:
    """Create meta.xml for an ODF document."""
    _register_namespaces()

    root = ET.Element(_ns("office", "document-meta"))
    root.set(_nsattr("office", "version"), "1.2")

    meta = ET.SubElement(root, _ns("office", "meta"))
    metadata = project.get("metadata", {})

    # Title
    title = ET.SubElement(meta, _ns("dc", "title"))
    title.text = metadata.get("title", project.get("name", ""))

    # Author / creator
    creator = ET.SubElement(meta, _ns("meta", "initial-creator"))
    creator.text = metadata.get("author", "libreoffice-cli")

    # Description
    desc = ET.SubElement(meta, _ns("dc", "description"))
    desc.text = metadata.get("description", "")

    # Subject
    subject = ET.SubElement(meta, _ns("dc", "subject"))
    subject.text = metadata.get("subject", "")

    # Creation date
    creation = ET.SubElement(meta, _ns("meta", "creation-date"))
    creation.text = metadata.get("created", datetime.now().isoformat())

    # Generator
    gen = ET.SubElement(meta, _ns("meta", "generator"))
    gen.text = "libreoffice-cli/1.0"

    return _xml_to_string(root)

def create_manifest_xml(doc_type: str) -> str:
    """Create META-INF/manifest.xml."""
    _register_namespaces()

    root = ET.Element(_ns("manifest", "manifest"))
    # Namespace is set automatically by _register_namespaces()
    root.set(_nsattr("manifest", "version"), "1.2")

    mimetype = ODF_MIMETYPES.get(doc_type, ODF_MIMETYPES["writer"])

    # Root entry
    entry = ET.SubElement(root, _ns("manifest", "file-entry"))
    entry.set(_nsattr("manifest", "full-path"), "/")
    entry.set(_nsattr("manifest", "version"), "1.2")
    entry.set(_nsattr("manifest", "media-type"), mimetype)

    # content.xml
    entry = ET.SubElement(root, _ns("manifest", "file-entry"))
    entry.set(_nsattr("manifest", "full-path"), "content.xml")
    entry.set(_nsattr("manifest", "media-type"), "text/xml")

    # styles.xml
    entry = ET.SubElement(root, _ns("manifest", "file-entry"))
    entry.set(_nsattr("manifest", "full-path"), "styles.xml")
    entry.set(_nsattr("manifest", "media-type"), "text/xml")

    # meta.xml
    entry = ET.SubElement(root, _ns("manifest", "file-entry"))
    entry.set(_nsattr("manifest", "full-path"), "meta.xml")
    entry.set(_nsattr("manifest", "media-type"), "text/xml")

    return _xml_to_string(root)

def _xml_to_string(root: ET.Element) -> str:
    """Convert an ElementTree element to a string with XML declaration."""
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(
        root, encoding="unicode", xml_declaration=False
    )


# TigerIQ bounded adapter. No installer, network, process execution, or external input files.
import hashlib
import io
import json
import pathlib
import re
import sys
import tempfile

ROOT = pathlib.Path(r"D:\TigerIQ\State\cli-anything-writer")
MAX_INPUT = 65536
ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def _text(value, limit):
    if type(value) is not str or not value.strip() or len(value) > limit:
        raise ValueError("INVALID_TEXT")
    if any(not (ord(c) in (9, 10, 13) or 32 <= ord(c) <= 0xD7FF or 0xE000 <= ord(c) <= 0xFFFD or 0x10000 <= ord(c) <= 0x10FFFF) for c in value):
        raise ValueError("INVALID_XML_CHARACTER")
    return value


def validate_request(value):
    if type(value) is not dict or set(value) != {"id", "title", "paragraphs"}:
        raise ValueError("INVALID_REQUEST")
    ident = value["id"]
    if type(ident) is not str or not ID_PATTERN.fullmatch(ident) or ident in RESERVED:
        raise ValueError("INVALID_ID")
    title = _text(value["title"], 200)
    paragraphs = value["paragraphs"]
    if type(paragraphs) is not list or not 1 <= len(paragraphs) <= 30:
        raise ValueError("INVALID_PARAGRAPHS")
    return ident, title, [_text(p, 2000) for p in paragraphs]


def render_writer(title, paragraphs):
    project = {"name": title, "metadata": {"title": title, "author": "TigerIQ"},
               "content": [{"type": "heading", "text": title, "level": 1}] +
                          [{"type": "paragraph", "text": p} for p in paragraphs]}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", ODF_MIMETYPES["writer"], compress_type=zipfile.ZIP_STORED)
        for name, xml in (("content.xml", create_content_xml("writer", project)),
                          ("styles.xml", create_styles_xml("writer", project)),
                          ("meta.xml", create_meta_xml(project)),
                          ("META-INF/manifest.xml", create_manifest_xml("writer"))):
            z.writestr(name, xml)
    data = buf.getvalue()
    # Inspect only the bytes generated by this process, never external XML/ZIP.
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if z.testzip() is not None or z.namelist() != ["mimetype", "content.xml", "styles.xml", "meta.xml", "META-INF/manifest.xml"] or z.getinfo("mimetype").compress_type != zipfile.ZIP_STORED or z.read("mimetype") != ODF_MIMETYPES["writer"].encode("ascii"):
            raise ValueError("ODF_STRUCTURE_FAILED")
        for name in z.namelist()[1:]:
            ET.fromstring(z.read(name))
        doc = ET.fromstring(z.read("content.xml"))
        heading = doc.find(".//" + _ns("text", "h"))
        actual = [p.text for p in doc.findall(".//" + _ns("text", "p"))]
        # XML normalizes carriage returns to LF.
        normalize = lambda v: v.replace("\r\n", "\n").replace("\r", "\n")
        if heading is None or heading.text != normalize(title) or actual != [normalize(p) for p in paragraphs]:
            raise ValueError("ODF_CONTENT_FAILED")
    return data


def run_request(value):
    ident, title, paragraphs = validate_request(value)
    root = ROOT
    if not root.is_dir() or root.is_symlink() or root.is_junction() or root.resolve() != root.absolute():
        raise ValueError("OUTPUT_ROOT_UNAVAILABLE_OR_REDIRECTED")
    data = render_writer(title, paragraphs)
    output = root / (ident + ".odt")
    fd, temp_name = tempfile.mkstemp(prefix="." + ident + ".", suffix=".tmp", dir=root)
    temp_path = pathlib.Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if temp_path.read_bytes() != data:
            raise ValueError("TEMP_READBACK_FAILED")
        # Same-volume hard-link publication is atomic and fails if output exists.
        os.link(temp_path, output)
        try:
            temp_path.unlink()
        except OSError:
            output.unlink(missing_ok=True)
            raise
        if output.read_bytes() != data:
            raise ValueError("OUTPUT_READBACK_FAILED")
    except BaseException:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return {"ok": True, "format": "odt", "path": str(output), "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "verification": "zip_xml_content_readback",
            "upstream_blob": "59a50348b33c878dec576f4e8d6b7591d0a420d5"}


def main():
    try:
        if len(sys.argv) != 1:
            raise ValueError("NO_ARGUMENTS_ALLOWED")
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if not raw or len(raw) > MAX_INPUT:
            raise ValueError("INPUT_SIZE_INVALID")
        def unique_pairs(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("DUPLICATE_KEY")
                result[key] = value
            return result
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_pairs)
        print(json.dumps(run_request(value, ROOT), ensure_ascii=True))
        return 0
    except (ValueError, OSError, UnicodeError, RecursionError) as exc:
        print(json.dumps({"ok": False, "error": str(exc) if type(exc) is ValueError and str(exc).isupper() else type(exc).__name__}, ensure_ascii=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
