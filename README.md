# 亲密空间 (Intimacy Space)

<p align="center">
  <img src="icon.png" width="100" alt="Intimacy Space Logo">
</p>

<p align="center">
  <strong>Home Assistant 亲密关系记录集成</strong>
</p>

<p align="center">
  <a href="https://www.home-assistant.io/">
    <img src="https://img.shields.io/badge/Home%20Assistant-2024.1+-41BDF5?logo=home-assistant&logoColor=white" alt="Home Assistant">
  </a>
  <a href="https://github.com/Smartzhang-github/intimacy/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/Smartzhang-github/intimacy" alt="License">
  </a>
  <a href="https://github.com/Smartzhang-github/intimacy/releases">
    <img src="https://img.shields.io/github/v/release/Smartzhang-github/intimacy" alt="Release">
  </a>
</p>

---

## ✨ 功能特性

### 📊 数据记录
- **完整字段支持**: 日期、时长、地点、满意度、愉悦度、心情、备注
- **多维度记录**: 姿势/体位、避孕措施、射精位置、是否带套、玩具使用
- **身体状态**: 身体状况、睡眠质量、饮酒状态
- **15种心情**: 开心、浪漫、热情、疲惫、平静、狂野、温柔、沮丧、好奇、清醒、期待、满足、惊讶、后悔、渴望
- **3种类别**: 做爱、自慰、春梦

### 📅 日历热力图
- **月度视图**: 直观显示每日记录密度
- **颜色编码**: 根据记录次数自动着色
- **快速导航**: 点击日期查看详情

### 📈 统计分析
- **多维度统计**: 次数、平均时长、平均满意度、平均愉悦度
- **时间筛选**: 全部、本月、本季、本年、自定义、按月
- **趋势图表**: 12个月趋势柱状图
- **分布统计**: 类别、地点、满意度、愉悦度、时长、姿势分布
- **环形饼图**: 12个字段的详细分布
- **奖章系统**: 多种成就奖章

### 🔄 周期管理
- **经期记录**: 记录经期开始和结束日期
- **周期追踪**: 自动计算周期阶段
- **可视化显示**: 经期🔴/易孕期🟠/安全期🟢 三色标识
- **智能预测**: 基于历史数据预测下次经期

### 🎨 主题系统
- **暗黑主题**: 默认深色主题
- **液态玻璃**: 毛玻璃效果
- **亮色主题**: 清爽浅色主题
- **粉色主题**: 浪漫粉色主题
- **浮动爱心**: 动态爱心背景动画

### 🔒 隐私安全
- **本地存储**: 所有数据存储在 Home Assistant 本地
- **无需云端**: 完全离线工作
- **认证保护**: 依赖 Home Assistant 认证系统

---

## 📦 安装

### 方法一：HACS（推荐）

1. 打开 HACS → 集成
2. 点击右上角三点菜单 → 自定义存储库
3. 输入仓库地址：`https://github.com/Smartzhang-github/intimacy`
4. 选择类别为「集成」
5. 重启 Home Assistant
6. 设置 → 设备与服务 → 添加集成 → 搜索「亲密空间」

### 方法二：手动安装

1. 下载最新 Release
2. 解压到 `config/custom_components/intimacy/`
3. 重启 Home Assistant
4. 设置 → 设备与服务 → 添加集成 → 搜索「亲密空间」

---

## 📁 文件结构

```
intimacy/
├── __init__.py          # 主集成文件（HTTP API）
├── config_flow.py       # 配置流程
├── const.py             # 常量定义
├── manifest.json        # 集成清单
├── sensor.py            # 传感器实体
├── icon.png             # 集成图标
├── icon.svg             # 集成图标（SVG）
├── brand/               # 品牌资源
├── icons/               # 图标资源
└── www/
    ├── index.html       # 前端页面
    ├── app.js           # 前端逻辑
    └── style.css        # 样式表
```

---

## 🚀 使用方法

### 首次配置

1. 安装集成后，进入 **设置 → 设备与服务 → 添加集成**
2. 搜索 **「亲密空间」** 并点击
3. 按照提示完成配置
4. 在左侧菜单出现 **「亲密空间」** 入口

### 记录数据

1. 点击左侧菜单的 **「亲密空间」**
2. 填写表单中的各项信息
3. 点击 **「保存记录」**

### 查看统计

1. 切换到 **「统计」** 标签页
2. 使用时间筛选器查看不同时段的数据
3. 查看趋势图表和分布统计

### 周期管理

1. 切换到 **「周期」** 标签页
2. 点击 **「添加经期记录」** 记录经期
3. 系统自动计算并显示当前周期阶段

---

## 📊 传感器实体

集成会自动创建以下传感器实体：

| 实体 | 说明 |
|------|------|
| `sensor.intimacy_total` | 总记录次数 |
| `sensor.intimacy_current_month` | 本月次数 |
| `sensor.intimacy_avg_duration` | 平均时长 |
| `sensor.intimacy_avg_satisfaction` | 平均满意度 |
| `sensor.intimacy_avg_pleasure` | 平均愉悦度 |
| `sensor.intimacy_last_record` | 上次记录详情 |
| `sensor.intimacy_period_phase` | 当前周期阶段 |
| `sensor.intimacy_trend_monthly` | 月度趋势 |

---

## 🛠️ 开发

### 技术栈

- **后端**: Python 3.12+ / Home Assistant Integration
- **前端**: Vanilla JavaScript / HTML5 / CSS3
- **数据库**: SQLite（通过 Home Assistant）
- **图标**: SVG Sprite

### 本地开发

1. 克隆仓库
2. 将 `intimacy` 文件夹复制到 Home Assistant 的 `config/custom_components/` 目录
3. 重启 Home Assistant
4. 修改代码后刷新浏览器查看效果

---

## 📝 更新日志

### v5.3.0 (2026-07-10)
- 📦 整理上传至 GitHub

### v5.0.0 (2026-07-09)
- ✨ 新增浮动爱心背景动画
- 🎨 新增液态玻璃主题
- 📊 新增环形饼图统计
- 🏆 新增奖章系统
- 🔧 优化统计页面时间筛选
- 🐛 修复中文变量名导致的渲染错误

### v4.7.0 (2026-07-08)
- ✨ 新增春梦类别
- 📊 新增12月趋势柱状图
- 🎨 优化图标显示

### v4.0.0 (2026-07-06)
- 🎉 首次发布
- ✅ 完整记录功能
- 📅 日历热力图
- 📈 基础统计

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

---

## 💬 支持

如果你觉得这个项目有用，请给个 ⭐ Star 支持一下！

有问题或建议？请 [提交 Issue](https://github.com/Smartzhang-github/intimacy/issues)

---

<p align="center">
  用 ❤️ 为 Home Assistant 社区打造
</p>
