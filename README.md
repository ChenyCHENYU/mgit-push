# mgit-push

🚀 **智能多平台 Git 推送工具** - 一次配置，多平台同步

## 🌟 特性

- 🎯 **一键推送** - 同时推送到 GitHub、Gitee、GitLab 等多个平台
- 🔧 **智能配置** - 自动识别现有仓库配置
- 🎨 **友好界面** - 彩色命令行界面

## 🌐 支持平台

- 🐙 **GitHub** - 全球最大的代码托管平台
- 🔥 **Gitee** - 中国领先的代码托管平台  
- 🦊 **GitLab** - DevOps一体化平台
- 💻 **GitCode** - CSDN代码托管平台

## 📦 安装

```bash
npm install -g mgit-push
```

## 🚀 使用

### 1. 初始化配置
```bash
mgit init
```

### 2. 推送到所有平台
```bash
mgit push
```

### 3. 查看状态  
```bash
mgit status
```

## 📘 命令说明

```bash
# 基本推送
mgit push

# 推送指定分支
mgit push main

# 强制推送（谨慎使用）
mgit push --force

# 推送并包含标签
mgit push --tags

# 跳过确认直接推送
mgit push --yes

# 查看状态
mgit status

# 重新配置
mgit config
```

## ⚙️ 配置文件

项目根目录会生成 `.mgit-push.json` 配置文件：

```json
{
  "username": "your-username",
  "repository": "your-repo-name", 
  "platforms": {
    "github": {
      "enabled": true,
      "url": "git@github.com:username/repo.git"
    },
    "gitee": {
      "enabled": true,
      "url": "git@gitee.com:username/repo.git"
    }
  }
}
```

## 🎯 使用场景

- **开源项目** - 同时发布到 GitHub 和 Gitee
- **代码备份** - 多平台备份重要代码
- **团队协作** - 不同团队使用不同平台

## 🐛 常见问题

**Q: 推送失败怎么办？**
```bash
# 检查SSH密钥
ssh -T git@github.com

# 查看详细状态
mgit status
```

**Q: 如何重新配置？**
```bash
mgit config
```

## 📄 许可证

MIT License

---

Made with ❤️ by [CHENYU](https://github.com/ChenyCHENYU)