#!/usr/bin/env python3
# list_files_by_ext.py - 列出指定扩展名的文件（含行数 & 大小）
import os
import sys
import glob
from pathlib import Path


def count_lines(path):
    try:
        with open(path, 'rb') as f:
            return sum(1 for _ in f)
    except Exception:
        return -1


def main():
    if len(sys.argv) < 2:
        print("Usage: python list_files_by_ext.py <ext>  e.g. \".py\", \"*.md\"")
        sys.exit(1)

    pattern = sys.argv[1]
    root = Path(".")

    # 排除目录
    exclude_dirs = {"__pycache__", ".git", "node_modules", ".vscode", "dist", "build"}

    matches = []
    for file_path in root.rglob(pattern):
        if file_path.is_file() and not any(part in exclude_dirs for part in file_path.parts):
            size = file_path.stat().st_size
            lines = count_lines(file_path)
            matches.append((str(file_path), lines, size))

    if not matches:
        print(f"No files matched '{pattern}'")
        return

    # 按大小降序
    matches.sort(key=lambda x: x[2], reverse=True)

    print(f"\n📁 Found {len(matches)} file(s) matching '{pattern}':\n")
    print(f"{'PATH':<60} {'LINES':<8} {'SIZE (B)':<12}")
    print("─" * 85)
    for path, lines, size in matches:
        line_str = str(lines) if lines >= 0 else "?"
        print(f"{path:<60} {line_str:<8} {size:<12}")


if __name__ == "__main__":
    main()
