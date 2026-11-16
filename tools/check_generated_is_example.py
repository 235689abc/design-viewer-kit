#!/usr/bin/env python3
"""生成物=示例数据防线:证明 kit 仓库跟踪的生成物与「用仓内示例 manifest 重新生成」的结果一致。

多项目共用一个 kit 克隆时,最大的事故面是把某个项目的真实清单生成物(index.json /
generated/*)留在了 kit 的工作树并被提交——内部拓扑随公开仓泄露。本脚本把这条红线
变成机器判定:

  用 design-viewer.config.example.json 重新生成一遍,再与 git 暂存区/HEAD 中的
  生成物做「归一化对比」(剔除天然漂移字段:generated_at 与 spec 的绝对路径),
  任何实质差异 => 退出码 1,并列出差异文件。

用法(CI 或推送前):
  python3 tools/gen_diagrams.py --config design-viewer.config.example.json
  python3 tools/check_generated_is_example.py            # 对比工作树(默认)
  python3 tools/check_generated_is_example.py --cached   # 对比暂存区(推送前)

绝对路径泄露防护:若生成物 JSON 中出现本机绝对路径(/Users/、/home/),直接判红。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

KIT_ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = KIT_ROOT / "apps" / "web" / "public" / "data" / "index.json"
GEN_DIR = KIT_ROOT / "docs" / "diagrams" / "generated"

# 归一化时剔除的字段:同一 manifest 在不同机器/时间重新生成必然漂移,不构成数据泄露信号
STRIP_META_KEYS = {"generated_at", "source_flows_json"}
ABSOLUTE_PATH_MARKERS = ("/Users/", "/home/")


def norm_obj(obj):
    if isinstance(obj, dict):
        return {k: norm_obj(v) for k, v in obj.items() if k not in STRIP_META_KEYS}
    if isinstance(obj, list):
        return [norm_obj(item) for item in obj]
    return obj


def read_blob(rev: str, path: Path) -> str | None:
    # rev=="index" 表示暂存区(git show :path),否则按提交名(git show HEAD:path)
    spec = f":{path.relative_to(KIT_ROOT)}" if rev == "index" else f"{rev}:{path.relative_to(KIT_ROOT)}"
    result = subprocess.run(
        ["git", "-C", str(KIT_ROOT), "show", spec],
        capture_output=True,
        text=True,
    )
    return result.stdout if result.returncode == 0 else None


def current_text(path: Path, rev: str) -> str | None:
    """当前侧文本:--cached 模式取暂存区 blob(工作树里的本机服务数据是合法存在,不算),
    默认模式取工作树文件(调用方刚用示例重新生成过)。"""
    if rev == "index":
        return read_blob("index", path)
    return path.read_text(encoding="utf-8") if path.is_file() else None


def staged_data_files() -> list[Path]:
    out = subprocess.run(
        [
            "git", "-C", str(KIT_ROOT), "diff", "--cached", "--name-only", "--",
            "docs/diagrams/generated", "apps/web/public/data",
        ],
        capture_output=True,
        text=True,
    ).stdout
    return [KIT_ROOT / line.strip() for line in out.splitlines() if line.strip()]


def compare_index(rev: str) -> list[str]:
    problems: list[str] = []
    raw = current_text(INDEX_PATH, rev)
    if raw is None:
        return [f"当前侧({rev})无 index.json,跳过该文件"]
    work = json.loads(raw)

    # 绝对路径防线(即便内容一致,出现在 JSON 里的本机路径本身就是泄露)
    for marker in ABSOLUTE_PATH_MARKERS:
        if marker in raw:
            problems.append(f"index.json 含本机绝对路径标记 {marker!r}")

    base = read_blob("HEAD", INDEX_PATH)
    if base is None:
        problems.append(f"HEAD 中无 {INDEX_PATH.relative_to(KIT_ROOT)}(首次提交生成物时忽略本条)")
        return problems
    committed = json.loads(base)
    if norm_obj(work) != norm_obj(committed):
        problems.append(
            "index.json 与提交版实质不同(剔除 generated_at/绝对路径后仍不一致)"
            " —— 生成物不是由仓内示例 manifest 产出的,疑似带入了项目数据"
        )
    return problems


def compare_generated(rev: str) -> list[str]:
    problems: list[str] = []
    # --cached 只查暂存的数据文件(工作树里的本机服务数据合法);默认查工作树全部生成物
    candidates = staged_data_files() if rev == "index" else sorted(GEN_DIR.rglob("*"))
    for path in candidates:
        if not path.is_file():
            continue
        rel = path.relative_to(KIT_ROOT)
        base = read_blob("HEAD", path)
        text = current_text(path, rev)
        if text is None:
            continue
        if base is None:
            problems.append(f"{rel}:当前侧新增、HEAD 中没有(示例不会新增生成物文件)")
            continue
        # 生成物为 markdown/文本:剔除生成时间行后再比
        work_lines = [l for l in text.splitlines() if "generated" not in l.lower() and "生成时间" not in l]
        base_lines = [l for l in base.splitlines() if "generated" not in l.lower() and "生成时间" not in l]
        if work_lines != base_lines:
            problems.append(f"{rel}:与提交版实质不同")
        for marker in ABSOLUTE_PATH_MARKERS:
            if marker in text:
                problems.append(f"{rel}:含本机绝对路径标记 {marker!r}")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description="生成物必须等于示例数据(数据防线)")
    parser.add_argument("--cached", action="store_true", help="对比暂存区(推送前)而非 HEAD")
    args = parser.parse_args()
    rev = "index" if args.cached else "HEAD"

    problems = compare_index(rev) + compare_generated(rev)
    if problems:
        print(json.dumps({"ok": False, "rev": rev, "problems": problems}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    print(json.dumps({"ok": True, "rev": rev, "checked": ["apps/web/public/data/index.json", "docs/diagrams/generated/**"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
