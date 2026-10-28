#!/usr/bin/env python3
"""
Phase gate for native Android work: parse EVERY Kotlin source/build file with
tree-sitter, plus well-formedness checks for XML resources and the Gradle
version catalog. The authoring sandbox has no JDK/Android SDK, so this
syntax-level gate must be green before each commit (docs/ANDROID.md § honesty
contract). Type-level correctness is validated by ./gradlew on the build
machine.

Usage: python3 scripts/check_android_syntax.py
Exit 0 = all green.
"""
from __future__ import annotations

import sys
import tomllib
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "android"


def parse_kotlin() -> list[str]:
    try:
        import tree_sitter_kotlin  # type: ignore
        from tree_sitter import Language, Parser  # type: ignore
    except ImportError:
        print("MISSING DEPS: pip install tree-sitter tree-sitter-kotlin", file=sys.stderr)
        sys.exit(2)

    lang = Language(tree_sitter_kotlin.language())
    parser = Parser(lang)
    errors: list[str] = []
    files = sorted({*ANDROID.rglob("*.kt"), *ANDROID.rglob("*.kts")})
    if not files:
        errors.append("no Kotlin files found under android/")

    def walk(node, src: bytes, out: list[str]) -> None:
        if node.type == "ERROR" or node.is_missing:
            row, col = node.start_point
            snippet = src[node.start_byte : min(node.end_byte, node.start_byte + 80)]
            out.append(
                f"  L{row + 1}:{col + 1} [{node.type}] {snippet.decode('utf-8', 'replace')!r}"
            )
            return  # report the outermost error; children are noise
        for child in node.children:
            walk(child, src, out)

    for f in files:
        src = f.read_bytes()
        tree = parser.parse(src)
        errs: list[str] = []
        walk(tree.root_node, src, errs)
        if errs:
            errors.append(f"{f.relative_to(ROOT)}:")
            errors.extend(errs)
    print(f"kotlin: parsed {len(files)} files")
    return errors


def check_xml() -> list[str]:
    errors: list[str] = []
    files = sorted(ANDROID.rglob("*.xml"))
    for f in files:
        try:
            ET.parse(f)
        except ET.ParseError as e:
            errors.append(f"{f.relative_to(ROOT)}: XML parse error: {e}")
    print(f"xml: checked {len(files)} files")
    return errors


def check_toml() -> list[str]:
    errors: list[str] = []
    for f in sorted(ANDROID.rglob("*.toml")):
        try:
            with f.open("rb") as fh:
                tomllib.load(fh)
        except Exception as e:  # noqa: BLE001 — report any decode failure
            errors.append(f"{f.relative_to(ROOT)}: TOML error: {e}")
    print(f"toml: checked {len(list(ANDROID.rglob('*.toml')))} files")
    return errors


def main() -> int:
    if not ANDROID.is_dir():
        print("android/ directory missing", file=sys.stderr)
        return 1
    errors = parse_kotlin() + check_xml() + check_toml()
    if errors:
        print("\nFAILED:")
        print("\n".join(errors))
        return 1
    print("android syntax gate: ALL GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
