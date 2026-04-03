# 中之我 (.skill)

## What This Is

一个开源的「自我蒸馏」工具。用户通过上传自己的聊天记录（微信、QQ、微博等多平台）或直接与 AI 对话，在可视化仪表盘的辅助下，深度探索内心真实的自我——性格特征、行为模式、价值观、情感模式——最终生成一个遵循 AgentSkills 标准的数字分身 Skill，可供 opencode / claude code 调用。

灵感来源于 [ex-skill](https://github.com/therealXiaomanChu/ex-skill)（把前任蒸馏成 AI Skill），但方向相反：不是蒸馏别人，而是蒸馏自己。

## Core Value

用户能把最真实的自我完整地表达出来，并被 AI 理解和记录——最终得到一个能用自己方式思考和回应的数字分身。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 用户可以上传多平台聊天记录（微信/QQ/微博等），系统自动解析并提取个人特征
- [ ] 用户可以在无数据上传的情况下，通过与 AI 深度对话来探索和表达真实自我
- [ ] 系统在可视化仪表盘中展示已提取的性格画像、记忆节点、关系网络、情感模式
- [ ] AI 通过深度引导式对话帮助用户挖掘潜意识中的价值观、恐惧、渴望
- [ ] 系统批量处理历史数据，支持增量更新（新数据可 merge 进已有画像）
- [ ] 用户可在前端配置自己的 API Key，支持云端模型和本地模型
- [ ] 所有数据本地处理（本地向量数据库），隐私优先
- [ ] 最终输出符合 AgentSkills 标准的数字分身 skill 文件
- [ ] CLI 工具支持核心流程（数据导入、分析、skill 生成）
- [ ] Web 界面提供完整的可视化展示和交互式对话体验

### Out of Scope

- 实时监控用户通讯软件 — 只处理用户主动上传的静态数据
- 社交/分享功能 — 这是个人工具，不是社交平台
- 移动端 App — v1 只做 CLI + Web 桌面端
- 商业化/付费功能 — 开源项目，用户自带 API Key

## Context

- 参考项目 ex-skill 使用 Python + AgentSkills 标准，采用双层架构（Memory + Persona）
- 用户数据可能非常大（多年聊天记录），需要本地向量数据库（ChromaDB）存储和高效检索
- 数据处理策略：批量分析历史数据提取核心特征，增量 merge 新数据，逐步蒸馏成紧凑的 skill
- 深度自我探索需要 AI 像心理访谈一样追问，引导用户自我觉察
- 技术栈：Python 后端 + React 前端，CLI + Web 双端

## Constraints

- **隐私**: 所有用户数据必须在本地处理，默认不发送到外部服务器（用户选择连接自己的 API Key 除外）
- **数据格式**: 需兼容多种聊天记录导出格式（WeChatMsg、留痕、PyWxDump、QQ txt/mht 等）
- **AgentSkills 标准**: 输出的 skill 文件必须符合 [AgentSkills](https://agentskills.io) 开放标准，兼容 opencode 和 claude code
- **数据量**: 需能处理多年累计的大量聊天记录（可能数万条消息）

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 本地向量数据库（ChromaDB） | 隐私优先，数据不出本机 | — Pending |
| Python + React | Python 擅长 NLP/数据处理，React 擅长复杂可视化 | — Pending |
| 批量 + 增量蒸馏策略 | 历史数据量大需批量处理，日常使用需增量更新 | — Pending |
| 用户自带 API Key | 开源项目不承担 API 成本，用户自由选择模型 | — Pending |
| 分层引导（数据先行 + 对话深化） | 降低使用门槛，无数据也能开始，有数据更精准 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-03 after initialization*
