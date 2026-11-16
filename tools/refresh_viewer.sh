#!/usr/bin/env bash
# 通用刷新门(多项目共用形态):校验清单 → 写 config → 生成图表/索引 → 构建 viewer →(可选)起看板
#
# 设计约定:kit 克隆是"引擎",各项目的 manifest 留在各自仓库;本脚本在 kit 内工作,
# 只把各项目路径当参数,不把任何项目数据写进 kit 的 git 跟踪区(config 自动写入且已被 gitignore)。
#
# 用法:
#   tools/refresh_viewer.sh --spec /path/to/yourproject/docs/diagrams/flows.json
#   tools/refresh_viewer.sh --spec ... --no-build        # 只校验+生成
#   tools/refresh_viewer.sh --spec ... --serve           # 构建后起本地看板(127.0.0.1:5273)
#   tools/refresh_viewer.sh --spec ... --project myproj  # 写入 config 的项目名(缺省取 manifest meta.project)
# 环境变量:无特殊依赖;python3/node 与 README 要求一致。
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC=""
PROJECT=""
NO_BUILD=0
SERVE=0

step() { printf '\n=== [refresh-viewer] %s ===\n' "$1"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --spec) SPEC="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --no-build) NO_BUILD=1; shift ;;
    --serve) SERVE=1; shift ;;
    *) echo "未知参数:$1(可用:--spec <path> / --project <name> / --no-build / --serve)" >&2; exit 2 ;;
  esac
done

[ -n "$SPEC" ] || { echo "缺 --spec <manifest 路径>" >&2; exit 2; }
[ -f "$SPEC" ] || { echo "manifest 不存在:$SPEC" >&2; exit 3; }
SPEC="$(cd "$(dirname "$SPEC")" && pwd)/$(basename "$SPEC")"
command -v python3 >/dev/null || { echo "缺 python3" >&2; exit 3; }

step "校验清单"
python3 "$KIT_ROOT/tools/validate_manifest.py" --spec "$SPEC"

step "写 kit 侧配置(每次重写防漂移;该文件已 gitignore,不进版本库)"
if [ -z "$PROJECT" ]; then
  PROJECT="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('meta',{}).get('project','unnamed-project'))" "$SPEC")"
fi
CONFIG="$KIT_ROOT/design-viewer.config.json"
python3 - "$PROJECT" "$SPEC" "$CONFIG" <<'PY'
import json, sys
project, spec, out = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = {
    "project": project,
    "spec": spec,
    "generatedDir": "docs/diagrams/generated",
    "indexOut": "apps/web/public/data/index.json",
    "historyDir": "apps/web/public/data/history",
    "historyManifest": "apps/web/public/data/history/manifest.json",
    "historyKeepLimit": 20,
    "skipHistory": True,
}
open(out, "w").write(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
print(f"config -> {out} (project={project})")
PY

step "生成图表与索引"
python3 "$KIT_ROOT/tools/gen_diagrams.py" --config "$CONFIG"

if [ "$NO_BUILD" -eq 1 ]; then
  printf '\n=== [refresh-viewer] 完成(--no-build:已校验+生成)===\n'
  exit 0
fi

step "构建 viewer"
( cd "$KIT_ROOT" && npm run build )

if [ "$SERVE" -eq 1 ]; then
  step "起本地 viewer(127.0.0.1:5273,Ctrl-C 停)"
  # 注意:必须进 apps/web 直起 vite——kit 根的 npm run dev 是 workspace 转发,会吞 --port
  ( cd "$KIT_ROOT/apps/web" && npx vite --port 5273 --strictPort --host 127.0.0.1 )
else
  printf '\n=== [refresh-viewer] 全部通过:校验 / 生成 / 构建(要本地看板加 --serve)===\n'
fi
