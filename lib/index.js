#!/usr/bin/env node

const { program } = require("commander");
const inquirer = require("inquirer");
const chalk = require("chalk");
const ora = require("ora");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const VERSION = require("../package.json").version;

// ============ 平台配置 ============
const PLATFORMS = {
  github: {
    name: "GitHub",
    icon: "🐙",
    pattern: /github\.com[:/]([^/]+)\/([^/.]+)/i,
    template: "git@github.com:{username}/{repo}.git",
  },
  gitee: {
    name: "Gitee",
    icon: "🔥",
    pattern: /gitee\.com[:/]([^/]+)\/([^/.]+)/i,
    template: "git@gitee.com:{username}/{repo}.git",
  },
  gitlab: {
    name: "GitLab",
    icon: "🦊",
    pattern: /gitlab\.com[:/]([^/]+)\/([^/.]+)/i,
    template: "git@gitlab.com:{username}/{repo}.git",
  },
  gitcode: {
    name: "GitCode",
    icon: "💻",
    pattern: /gitcode\.com[:/]([^/]+)\/([^/.]+)/i,
    template: "git@gitcode.com:{username}/{repo}.git",
  },
};

// ============ Git 工具函数 ============
const gitCommand = (cmd, defaultValue = "") => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim() || defaultValue;
  } catch {
    return defaultValue;
  }
};

const isGitRepo = () => gitCommand("git rev-parse --git-dir", null) !== null;
const getGitUserName = () => gitCommand("git config user.name", "ChenYu");
const getCurrentBranch = () => gitCommand("git branch --show-current", "main");

function getRemotes() {
  try {
    const output = execSync("git remote -v", { encoding: "utf8" });
    const remotes = {};

    output.split("\n").forEach((line) => {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
      if (match) {
        const [, name, url, type] = match;
        if (!remotes[name]) remotes[name] = {};
        remotes[name][type] = url;
      }
    });

    return remotes;
  } catch {
    return {};
  }
}

const hasUncommittedChanges = () => gitCommand("git status --porcelain", "").length > 0;

// 获取未提交更改的详细信息
function getUncommittedInfo() {
  const status = gitCommand("git status --porcelain", "");
  if (!status) return null;
  
  const lines = status.split("\n").filter(l => l.trim());
  const stats = {
    modified: 0,
    added: 0,
    deleted: 0,
    untracked: 0,
    total: lines.length
  };
  
  lines.forEach(line => {
    const flag = line.substring(0, 2);
    if (flag.includes("M")) stats.modified++;
    else if (flag.includes("A")) stats.added++;
    else if (flag.includes("D")) stats.deleted++;
    else if (flag === "??") stats.untracked++;
  });
  
  return stats;
}

const remoteExists = (name) => gitCommand(`git remote get-url ${name}`, null) !== null;

function parseRepoInfo(url) {
  for (const [platform, config] of Object.entries(PLATFORMS)) {
    const match = url.match(config.pattern);
    if (match) {
      return { platform, username: match[1], repo: match[2], url };
    }
  }
  return null;
}

const escapeArg = (arg) => 
  process.platform === "win32"
    ? `"${arg.replace(/"/g, '""')}"`
    : `'${arg.replace(/'/g, "'\"'\"'")}'`;

// ============ 配置管理 ============
const CONFIG_FILE = ".mgit-push.json";

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (error) {
    console.log(chalk.yellow("⚠️ 配置文件读取失败"));
  }
  return null;
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error(chalk.red("❌ 配置保存失败:"), error.message);
    return false;
  }
}

// ============ .gitignore 管理 ============
function updateGitignore() {
  const gitignorePath = ".gitignore";
  
  try {
    let content = fs.existsSync(gitignorePath) 
      ? fs.readFileSync(gitignorePath, "utf8") 
      : "";
    
    // 检查是否已存在
    if (content.includes(CONFIG_FILE)) {
      return { status: "exists" };
    }
    
    // 添加到 .gitignore
    const newEntry = content && !content.endsWith("\n") ? "\n" : "";
    content += `${newEntry}# mgit-push 本地配置\n${CONFIG_FILE}\n`;
    
    fs.writeFileSync(gitignorePath, content);
    return { status: "added" };
  } catch (error) {
    return { status: "error", error: error.message };
  }
}

// ============ 仓库分析 ============
function analyzeRepo() {
  const info = {
    repo: null,  // 初始为 null，优先从 remote 获取
    platforms: {},
    gitUserName: getGitUserName(),
  };

  const remotes = getRemotes();
  
  // 解析现有远程仓库，优先获取仓库名
  Object.entries(remotes).forEach(([name, urls]) => {
    const url = urls.fetch || urls.push;
    if (url) {
      const parsed = parseRepoInfo(url);
      if (parsed) {
        // 优先从 origin 或第一个找到的 remote 获取仓库名
        if (!info.repo || name === 'origin') {
          info.repo = parsed.repo;
        }
        
        if (!info.platforms[parsed.platform]) {
          info.platforms[parsed.platform] = {
            username: parsed.username,
            remoteName: name,
            url: url,
          };
        }
      }
    }
  });

  // 如果没有从 remote 获取到，则使用目录名
  if (!info.repo) {
    info.repo = path.basename(process.cwd());
  }

  return info;
}

// ============ 主要功能 ============
async function initConfig() {
  console.log(chalk.cyan("\n🚀 mgit-push 配置向导\n"));

  const repoInfo = analyzeRepo();

  // 显示检测信息
  console.log(chalk.cyan(`🔍 检测到 Git 用户名: ${chalk.bold(repoInfo.gitUserName)}`));

  // 询问账户名是否一致
  const { consistent } = await inquirer.prompt([{
    type: "confirm",
    name: "consistent",
    message: `您在各平台的账户名都是 "${repoInfo.gitUserName}" 吗?`,
    default: false,
  }]);

  // 获取仓库名
  const repoPrompt = {
    type: "input",
    name: "repo",
    message: "请输入仓库名称:",
    default: repoInfo.repo,
    validate: input => input.trim().length > 0 || "仓库名不能为空",
  };
  
  // 如果从 remote 获取到了仓库名，显示来源
  if (repoInfo.repo) {
    const isFromRemote = Object.keys(repoInfo.platforms).length > 0;
    if (isFromRemote) {
      console.log(chalk.green(`✓ 从远程仓库检测到: ${chalk.bold(repoInfo.repo)}`));
    } else {
      console.log(chalk.gray(`  建议使用目录名: ${repoInfo.repo}`));
    }
  }
  
  const { repo } = await inquirer.prompt([repoPrompt]);

  // 选择平台
  const { platforms } = await inquirer.prompt([{
    type: "checkbox",
    name: "platforms",
    message: "请选择要推送的平台:",
    choices: Object.entries(PLATFORMS).map(([key, config]) => ({
      name: `${config.icon} ${config.name}`,
      value: key,
      checked: ["github", "gitee"].includes(key),
    })),
    validate: input => input.length > 0 || "至少选择一个平台",
  }]);

  // 配置平台信息
  const platformConfigs = {};
  const commonUsername = consistent ? repoInfo.gitUserName : null;

  for (const platform of platforms) {
    const platformInfo = PLATFORMS[platform];
    let username = commonUsername;

    if (!username) {
      const existingUsername = repoInfo.platforms[platform]?.username;
      
      console.log(chalk.cyan(`\n${platformInfo.icon} 配置 ${platformInfo.name}`));
      if (existingUsername) {
        console.log(chalk.green(`   ✓ 检测到现有配置: ${chalk.bold(existingUsername)}`));
      }

      const { inputUsername } = await inquirer.prompt([{
        type: "input",
        name: "inputUsername",
        message: `请输入您在 ${platformInfo.name} 的账户名:`,
        default: existingUsername || repoInfo.gitUserName,
        validate: input => input.trim().length > 0 || "用户名不能为空",
      }]);
      username = inputUsername;
    }

    platformConfigs[platform] = {
      enabled: true,
      username,
      url: platformInfo.template
        .replace("{username}", username)
        .replace("{repo}", repo),
    };
  }

  const config = {
    repository: repo,
    platforms: platformConfigs,
    createdAt: new Date().toISOString(),
  };

  if (saveConfig(config)) {
    // 更新 .gitignore
    const gitignoreResult = updateGitignore();
    
    // 显示配置摘要
    console.log(chalk.green("\n✅ 配置保存成功！"));
    
    if (gitignoreResult.status === "added") {
      console.log(chalk.green(`✅ 已将 ${CONFIG_FILE} 添加到 .gitignore`));
    } else if (gitignoreResult.status === "error") {
      console.log(chalk.yellow(`⚠️  请手动将 "${CONFIG_FILE}" 添加到 .gitignore`));
    }

    // 配置摘要
    console.log(chalk.cyan("\n📋 配置摘要"));
    console.log(chalk.gray("━".repeat(50)));
    console.log(`📁 ${chalk.bold("仓库:")} ${chalk.cyan(config.repository)}`);
    console.log(`🔗 ${chalk.bold("平台:")} ${Object.keys(config.platforms).length} 个`);
    
    Object.entries(config.platforms).forEach(([platform, cfg]) => {
      const info = PLATFORMS[platform];
      console.log(`   ${info.icon} ${info.name.padEnd(8)} → ${chalk.cyan(cfg.username)}`);
    });

    // 使用指南
    console.log(chalk.cyan("\n🚀 使用指南"));
    console.log(chalk.gray("━".repeat(50)));
    console.log(`${chalk.bold("推送:")} ${chalk.green("mgit push")}`);
    console.log(`${chalk.bold("状态:")} ${chalk.green("mgit status")}`);
    console.log(`${chalk.bold("重配:")} ${chalk.green("mgit config")}`);

    console.log(chalk.yellow("\n🎉 配置完成！运行 ") + 
      chalk.bold.green("mgit push") + 
      chalk.yellow(" 开始推送！"));
  }

  return config;
}

async function setupRemotes(config) {
  const spinner = ora("配置远程仓库...").start();

  for (const [platform, cfg] of Object.entries(config.platforms)) {
    if (!cfg.enabled) continue;
    
    try {
      const cmd = remoteExists(platform) 
        ? `git remote set-url ${platform} ${escapeArg(cfg.url)}`
        : `git remote add ${platform} ${escapeArg(cfg.url)}`;
      
      execSync(cmd, { stdio: "pipe" });
      spinner.text = `${PLATFORMS[platform].icon} ${platform} 已配置`;
    } catch (error) {
      spinner.fail(`${platform} 配置失败: ${error.message}`);
      return false;
    }
  }

  spinner.succeed("远程仓库配置完成");
  return true;
}

function pushToRemote(platform, branch, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ["push"];
    if (options.force) args.push("--force");
    if (options.tags) args.push("--tags");
    args.push(platform, branch);

    const git = spawn("git", args, { stdio: ["inherit", "pipe", "pipe"] });
    let output = "", error = "";

    git.stdout.on("data", data => output += data.toString());
    git.stderr.on("data", data => error += data.toString());
    git.on("close", code => {
      code === 0 
        ? resolve({ stdout: output, stderr: error })
        : reject(new Error(error || `推送失败，退出码: ${code}`));
    });
  });
}

async function pushToAll(options = {}) {
  // 检查 Git 仓库
  if (!isGitRepo()) {
    console.log(chalk.red("❌ 当前目录不是 Git 仓库"));
    return;
  }

  // 处理未提交的更改
  if (hasUncommittedChanges()) {
    const changes = getUncommittedInfo();
    console.log(chalk.yellow("\n⚠️  检测到未提交的更改"));
    
    // 显示更改统计
    const changeDetails = [];
    if (changes.modified) changeDetails.push(`${changes.modified} 个修改`);
    if (changes.added) changeDetails.push(`${changes.added} 个新增`);
    if (changes.deleted) changeDetails.push(`${changes.deleted} 个删除`);
    if (changes.untracked) changeDetails.push(`${changes.untracked} 个未跟踪`);
    
    console.log(chalk.gray(`   ${changeDetails.join(", ")}\n`));
    
    const { action } = await inquirer.prompt([{
      type: "list",
      name: "action",
      message: "请选择操作:",
      choices: [
        { 
          name: `${chalk.green("→")} 快速提交  ${chalk.gray("(使用 git commit 快速提交)")}`, 
          value: "commit" 
        },
        { 
          name: `${chalk.yellow("→")} 跳过提交  ${chalk.gray("(直接推送已提交的内容)")}`, 
          value: "ignore" 
        },
        { 
          name: `${chalk.cyan("→")} 退出程序  ${chalk.gray("(手动使用 git cz 等工具提交)")}`, 
          value: "exit" 
        },
        { 
          name: `${chalk.red("→")} 取消推送  ${chalk.gray("(返回命令行)")}`, 
          value: "cancel" 
        },
      ],
    }]);

    switch (action) {
      case "cancel":
        console.log(chalk.yellow("👋 推送已取消"));
        return;
      
      case "exit":
        console.log(chalk.cyan("💡 提示: 请手动提交更改后再运行 mgit push"));
        process.exit(0);
      
      case "commit":
        const { message } = await inquirer.prompt([{
          type: "input",
          name: "message",
          message: "提交信息:",
          validate: input => input.trim() || "提交信息不能为空",
        }]);

        try {
          execSync("git add .");
          execSync(`git commit -m ${escapeArg(message)}`);
          console.log(chalk.green("✅ 更改已提交"));
        } catch (error) {
          console.error(chalk.red("❌ 提交失败:"), error.message);
          return;
        }
        break;
      
      case "ignore":
        console.log(chalk.gray("ℹ️  跳过未提交的更改，继续推送..."));
        break;
    }
  }

  // 加载配置
  let config = loadConfig();
  if (!config) {
    console.log(chalk.yellow("⚠️ 未找到配置文件，开始初始化..."));
    config = await initConfig();
    if (!config) return;
  }

  // 设置远程仓库
  if (!await setupRemotes(config)) return;

  // 获取启用的平台
  const enabledPlatforms = Object.entries(config.platforms)
    .filter(([, cfg]) => cfg.enabled)
    .map(([platform]) => platform);

  if (enabledPlatforms.length === 0) {
    console.log(chalk.red("❌ 没有启用的平台"));
    return;
  }

  const branch = options.branch || getCurrentBranch();

  // 确认推送
  if (!options.yes) {
    const { confirm } = await inquirer.prompt([{
      type: "confirm",
      name: "confirm",
      message: `推送 ${chalk.cyan(branch)} 到 ${chalk.green(enabledPlatforms.join(", "))}?`,
      default: true,
    }]);

    if (!confirm) {
      console.log(chalk.yellow("👋 推送已取消"));
      return;
    }
  }

  // 执行推送
  console.log(chalk.cyan(`\n🚀 推送 ${branch} 分支...\n`));
  const results = { success: [], failed: [] };

  for (const platform of enabledPlatforms) {
    const info = PLATFORMS[platform];
    const spinner = ora(`推送到 ${info.icon} ${platform}...`).start();

    try {
      await pushToRemote(platform, branch, options);
      spinner.succeed(`${info.icon} ${platform} 推送成功`);
      results.success.push(platform);
    } catch (error) {
      spinner.fail(`${info.icon} ${platform} 推送失败`);
      results.failed.push({ platform, error: error.message });
    }
  }

  // 显示结果
  console.log(chalk.cyan("\n📊 推送结果\n"));
  if (results.success.length > 0) {
    console.log(chalk.green(`✅ 成功: ${results.success.join(", ")}`));
  }
  if (results.failed.length > 0) {
    console.log(chalk.red(`❌ 失败: ${results.failed.map(f => f.platform).join(", ")}`));
    console.log(chalk.yellow("\n💡 提示: 检查 SSH 密钥配置和账户名设置"));
  }
}

async function showStatus() {
  if (!isGitRepo()) {
    console.log(chalk.red("❌ 当前目录不是 Git 仓库"));
    return;
  }

  const config = loadConfig();
  if (!config) {
    console.log(chalk.yellow('⚠️ 未找到配置文件，请运行 "mgit init"'));
    return;
  }

  console.log(chalk.cyan("\n📊 多平台 Git 状态\n"));
  console.log(chalk.blue(`当前分支: ${getCurrentBranch()}\n`));

  Object.entries(config.platforms).forEach(([platform, cfg]) => {
    if (!cfg.enabled) return;
    
    const info = PLATFORMS[platform];
    const exists = remoteExists(platform);

    console.log(`${info.icon} ${chalk.bold(info.name)}`);
    console.log(`   用户: ${cfg.username}`);
    console.log(`   状态: ${exists ? chalk.green("✅ 已配置") : chalk.red("❌ 未配置")}`);
  });
}

// ============ CLI 命令定义 ============
program
  .name("mgit-push")
  .description("智能多平台 Git 推送工具")
  .version(VERSION);

program
  .command("push [branch]")
  .description("推送到配置的平台")
  .option("-f, --force", "强制推送")
  .option("-t, --tags", "推送标签")
  .option("-y, --yes", "跳过确认")
  .action(async (branch, options) => {
    await pushToAll({ branch, ...options });
  });

program
  .command("init")
  .description("初始化配置")
  .action(initConfig);

program
  .command("status")
  .alias("st")
  .description("显示状态")
  .action(showStatus);

program
  .command("config")
  .description("重新配置")
  .action(initConfig);

// 默认行为
if (process.argv.length === 2) {
  console.log(chalk.cyan("🚀 mgit-push - 智能多平台 Git 推送工具\n"));

  if (isGitRepo()) {
    const config = loadConfig();
    console.log(config 
      ? chalk.green("✅ 已配置，运行 mgit push 开始推送")
      : chalk.yellow("⚠️ 未配置，运行 mgit init 开始配置"));
  } else {
    console.log(chalk.red("❌ 当前目录不是 Git 仓库"));
  }

  console.log(chalk.gray("\n📖 查看帮助: mgit --help"));
} else {
  program.parse(process.argv);
}