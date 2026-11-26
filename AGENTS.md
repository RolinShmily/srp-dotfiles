# 维护钩子

| 触发 | 同步动作 |
| --- | --- |
| 功能新增 / 行为变更 | 更新 `README.md` / `README.zh-CN.md` 三模块；`docs/architecture.md`（组成与数据流）或 `docs/design.md`（取舍）；`scripts/tests/` 或 `worker/test.mjs` 对应样例 |
| CLI / 参数 / API / Catalog Schema 变更 | 更新 `docs/reference.md` |
| `manifest/*.json` 或 `configs/` 内容变更 | 运行 `python scripts/gen_catalog.py` 并提交 `worker/public/catalog.json`；Manifest 字段变化时同步 `docs/reference.md`「Manifest schema」；流程变化时更新 `docs/development.md` 扩展指南 |
| 镜像 / 代理配置变更 | 同步 `install.sh` / `install.ps1` 的内置 `GH_PREFIXES` fallback；更新 `docs/reference.md`「Mirror schema」 |
| 构建 / 测试流程或 workflow 变更 | 更新 `docs/development.md`「Tests and checks」「Automated CI & deployment」、`docs/reference.md`「CI/CD」及本文件钩子 |
| `scripts/tests/` 或 `worker/test.mjs` 结构 / 样例变更 | 更新 `.github/workflows/test.yml` 路径与 `docs/development.md` 测试段 |
| 依赖 / 第三方代码 / 资源变更 | 更新 `THIRD_PARTY_NOTICES.md`；同步 `README.md` / `README.zh-CN.md` 的 Acknowledgements |
| 仓库顶层目录或 `scripts/`、`manifest/`、`configs/`、`worker/` 资产位置变更 | 更新 `docs/architecture.md`「Repository layout」；workflow `paths` 过滤；本文件 |
| docs 四件套文件名或职责调整 | 同步 README 文档表、docs 内部链接与本文件 |

## 备注

- 不设 `CHANGELOG.md` / `release.yml` / 版本 tag：采用 rolling `main`，commit history 即变更记录（见 `docs/design.md`）。
- 不设 `LICENSE`：`LICENSE` 已于 2026-09-02 刻意移除；补加前需确认代码与第三方素材的授权范围。
