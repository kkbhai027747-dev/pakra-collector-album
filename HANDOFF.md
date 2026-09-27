# Collector album prototype

This is an unreleased standalone experiment, not a dependency of the current V9 theme. Read [README.md](README.md) for its UI, Node service, setup and limitations.

The catalog build uses the two hash-pinned files in `fixtures/catalog-source/`. They are preserved reference inputs for the 25-card demonstration, imported from the earlier single-card handoff. They are not a second editable website theme. `catalog-sources.json` now points to these local fixtures so the experiment no longer depends on an adjacent website project or the current store catalog.

Source: `codex/project-handoff-20260921`, commit `151ba39`. This relocation updates the fixture directory, the generated catalog's two input-path records, and setup documentation. The catalog content, service, UI and pricing rules are unchanged. The historical source manifest is retained as provenance, not relabelled as a current V9 deployment.

中文：本项目尚未上线，不是当前 V9 的运行依赖。原25张卡演示所需的两个固定哈希输入保存在 `fixtures/catalog-source/`，用于离线构建和测试，不代表实时商品数据。迁移调整输入目录、生成目录里的两条来源路径及操作说明，卡片内容和业务逻辑不变；不要将实验主题文件整包覆盖进 V9。
