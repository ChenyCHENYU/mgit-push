#!/usr/bin/env node

const { program } = require("commander");
const inquirer = require("inquirer");
const chalk = require("chalk");
const ora = require("ora");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

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
function isGitRepo() {
  try {
    execSync("git rev-parse --git-dir", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getGitUserName() {
  try {
    return (
      execSync("git config user.name", { encoding: "utf8" }).trim() || "ChenYu"
    );
  } catch {
    return "ChenYu";
  }
}

function getCurrentBranch() {
  try {
    return (
      execSync("git branch --show-current", { encoding: "utf8" }).trim() ||
      "main"
    );
  } catch {
    return "main";
  }
}

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

function hasUncommittedChanges() {
  try {
    const status = execSync("git status --porcelain", { encoding: "utf8" });
    return status.length > 0;
  } catch {
    return false;
  }
}

function remoteExists(name) {
  try {
    execSync(`git remote get-url ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function parseRepoInfo(url) {
  for (const [platform, config] of Object.entries(PLATFORMS)) {
    const match = url.match(config.pattern);
    if (match) {
      return {
        platform,
        username: match[1],
        repo: match[2],
        url,
      };
    }
  }
  return null;
}

function escapeArg(arg) {
  return process.platform === "win32"
    ? `"${arg.replace(/"/g, '""')}"`
    : `'${arg.replace(/'/g, "'\"'\"'")}'`;
}

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

function analyzeRepo() {
  const info = {
    repo: null,
    platforms: {}, // 存储各平台的用户名
    gitUserName: getGitUserName(),
  };

  try {
    const remotes = getRemotes();

    // 从现有远程解析各平台信息
    for (const [name, urls] of Object.entries(remotes)) {
      const url = urls.fetch || urls.push;
      if (url) {
        const parsed = parseRepoInfo(url);
        if (parsed) {
          if (!info.repo) info.repo = parsed.repo;
          // 优先使用平台名作为key
          info.platforms[parsed.platform] = {
            username: parsed.username,
            remoteName: name,
            url: url,
          };
        }
      }
    }

    // 检查是否有与平台同名的remotes
    Object.keys(PLATFORMS).forEach((platformName) => {
      if (remotes[platformName] && !info.platforms[platformName]) {
        const url = remotes[platformName].fetch || remotes[platformName].push;
        if (url) {
          const parsed = parseRepoInfo(url);
          if (parsed) {
            info.platforms[platformName] = {
              username: parsed.username,
              remoteName: platformName,
              url: url,
            };
          }
        }
      }
    });

    // 从目录名推测仓库名
    if (!info.repo) {
      info.repo = path.basename(process.cwd());
    }
  } catch (error) {
    // 静默处理
  }

  return info;
}

// ============ 主要功能 ============
async function initConfig() {
  console.log(chalk.cyan("\n🚀 mgit-push 配置向导\n"));

  const repoInfo = analyzeRepo();

  // 显示检测到的Git用户名
  console.log(
    chalk.cyan(
      `🔍 检测到您的 Git 用户名为: ${chalk.bold(repoInfo.gitUserName)}`
    )
  );

  // 询问各平台账户名是否与Git用户名一致
  const usernameConsistent = await inquirer.prompt([
    {
      type: "confirm",
      name: "consistent",
      message: `您在各个平台的账户名都是 "${repoInfo.gitUserName}" 吗?`,
      default: false,
    },
  ]);

  // 首先获取仓库名
  const repoAnswer = await inquirer.prompt([
    {
      type: "input",
      name: "repo",
      message: "请输入仓库名称:",
      default: repoInfo.repo,
      validate: (input) => input.trim().length > 0 || "仓库名不能为空",
    },
  ]);

  // 选择要配置的平台
  const platformAnswer = await inquirer.prompt([
    {
      type: "checkbox",
      name: "platforms",
      message: "请选择要推送的平台:",
      choices: Object.entries(PLATFORMS).map(([key, config]) => ({
        name: `${config.icon} ${config.name}`,
        value: key,
        checked: ["github", "gitee"].includes(key),
      })),
    },
  ]);

  if (platformAnswer.platforms.length === 0) {
    console.log(chalk.red("❌ 至少选择一个平台"));
    return;
  }

  let commonUsername = null;
  const platformConfigs = {};

  if (usernameConsistent.consistent) {
    // 直接使用Git用户名
    commonUsername = repoInfo.gitUserName;
    console.log(
      chalk.green(
        `\n✅ 将为所有平台使用统一账户名: ${chalk.bold(commonUsername)}`
      )
    );
  }

  // 为每个平台配置用户名
  for (const platform of platformAnswer.platforms) {
    const platformInfo = PLATFORMS[platform];
    const existingInfo = repoInfo.platforms[platform];

    let username = commonUsername;

    if (!username) {
      // 单独设置模式：为每个平台设置用户名
      const hasExisting = existingInfo?.username;

      let defaultValue, sourceInfo;
      if (hasExisting) {
        defaultValue = hasExisting;
        sourceInfo = "(从现有配置检测)";
      } else {
        defaultValue = repoInfo.gitUserName;
        sourceInfo = "(Git用户名)";
      }

      console.log(
        chalk.cyan(`\n${platformInfo.icon} 配置 ${platformInfo.name} 平台`)
      );
      if (hasExisting) {
        console.log(
          chalk.green(`   ✓ 检测到现有配置: ${chalk.bold(defaultValue)}`)
        );
      } else {
        console.log(
          chalk.gray(`   建议值: ${chalk.cyan(defaultValue)} ${sourceInfo}`)
        );
      }

      const answer = await inquirer.prompt([
        {
          type: "input",
          name: "username",
          message: `请输入您在 ${platformInfo.name} 的账户名:`,
          default: defaultValue,
          validate: (input) => input.trim().length > 0 || "用户名不能为空",
        },
      ]);
      username = answer.username;
    }

    const url = platformInfo.template
      .replace("{username}", username)
      .replace("{repo}", repoAnswer.repo);

    platformConfigs[platform] = {
      enabled: true,
      username: username,
      url: url,
    };
  }

  const config = {
    repository: repoAnswer.repo,
    platforms: platformConfigs,
    createdAt: new Date().toISOString(),
  };

  if (saveConfig(config)) {
    // 精致的配置摘要
    console.log(chalk.green("\n✅ 配置保存成功！"));

    console.log(chalk.cyan("\n📋 配置摘要"));
    console.log(chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(
      `📁 ${chalk.bold("仓库名称:")} ${chalk.cyan(config.repository)}`
    );
    console.log(
      `🔗 ${chalk.bold("平台配置:")} ${
        Object.keys(config.platforms).length
      } 个平台`
    );

    Object.entries(config.platforms).forEach(([platform, config]) => {
      const platformInfo = PLATFORMS[platform];
      console.log(
        `   ${platformInfo.icon} ${chalk.bold(
          platformInfo.name.padEnd(8)
        )} ${chalk.cyan(config.username)}`
      );
    });

    // 配置文件信息
    console.log(chalk.cyan("\n🔧 配置文件维护"));
    console.log(chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(
      `📄 ${chalk.bold("配置文件:")} ${chalk.cyan(".mgit-push.json")}`
    );
    console.log(`📝 ${chalk.bold("维护方式:")}`);
    console.log(`   • 命令重配: ${chalk.cyan("mgit config")}`);
    console.log(`   • 手动编辑: ${chalk.cyan(".mgit-push.json")}`);
    console.log(`   • 查看状态: ${chalk.cyan("mgit status")}`);

    // 使用指南
    console.log(chalk.cyan("\n🚀 使用指南"));
    console.log(chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(`${chalk.bold("🎯 推送代码:")} ${chalk.green("mgit push")}`);
    console.log(`${chalk.bold("📊 查看状态:")} ${chalk.green("mgit status")}`);
    console.log(`${chalk.bold("🔧 重新配置:")} ${chalk.green("mgit config")}`);
    console.log(`${chalk.bold("📖 查看帮助:")} ${chalk.green("mgit --help")}`);

    console.log(
      chalk.yellow("\n🎉 配置完成！运行 ") +
        chalk.bold.green("mgit push") +
        chalk.yellow(" 开始多平台推送！")
    );
  }

  return config;
}

async function setupRemotes(config) {
  const spinner = ora("正在配置远程仓库...").start();

  for (const [platform, platformConfig] of Object.entries(config.platforms)) {
    if (platformConfig.enabled) {
      try {
        const platformInfo = PLATFORMS[platform];

        if (remoteExists(platform)) {
          execSync(
            `git remote set-url ${platform} ${escapeArg(platformConfig.url)}`,
            { stdio: "pipe" }
          );
        } else {
          execSync(
            `git remote add ${platform} ${escapeArg(platformConfig.url)}`,
            { stdio: "pipe" }
          );
        }

        spinner.text = `${platformInfo.icon} ${platform} 配置完成`;
      } catch (error) {
        spinner.fail(`${platform} 配置失败: ${error.message}`);
        return false;
      }
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

    let output = "";
    let error = "";

    git.stdout.on("data", (data) => (output += data.toString()));
    git.stderr.on("data", (data) => (error += data.toString()));

    git.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: output, stderr: error });
      } else {
        reject(new Error(error || `推送失败，退出码: ${code}`));
      }
    });
  });
}

async function pushToAll(options = {}) {
  // 检查Git仓库
  if (!isGitRepo()) {
    console.log(chalk.red("❌ 当前目录不是 Git 仓库"));
    return;
  }

  // 检查未提交的更改
  if (hasUncommittedChanges()) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: chalk.yellow("⚠️ 检测到未提交的更改，请选择:"),
        choices: [
          { name: "💾 提交更改后继续", value: "commit" },
          { name: "⚠️ 忽略并继续", value: "ignore" },
          { name: "❌ 取消推送", value: "cancel" },
        ],
      },
    ]);

    if (action === "cancel") {
      console.log(chalk.yellow("👋 推送已取消"));
      return;
    }

    if (action === "commit") {
      const { message } = await inquirer.prompt([
        {
          type: "input",
          name: "message",
          message: "请输入提交信息:",
          validate: (input) => input.trim().length > 0 || "提交信息不能为空",
        },
      ]);

      try {
        execSync("git add .");
        execSync(`git commit -m ${escapeArg(message)}`);
        console.log(chalk.green("✅ 更改已提交"));
      } catch (error) {
        console.error(chalk.red("❌ 提交失败:"), error.message);
        return;
      }
    }
  }

  // 获取配置
  let config = loadConfig();
  if (!config) {
    console.log(chalk.yellow("⚠️ 未找到配置文件，开始初始化..."));
    config = await initConfig();
  }

  // 设置远程仓库
  if (!(await setupRemotes(config))) {
    return;
  }

  // 获取要推送的平台和分支
  const enabledPlatforms = Object.entries(config.platforms)
    .filter(([, cfg]) => cfg.enabled)
    .map(([platform]) => platform);

  if (enabledPlatforms.length === 0) {
    console.log(chalk.red("❌ 没有启用的推送平台"));
    return;
  }

  const branch = options.branch || getCurrentBranch();

  // 确认推送
  if (!options.yes) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `确认推送 ${chalk.cyan(branch)} 分支到 ${chalk.green(
          enabledPlatforms.join(", ")
        )}?`,
        default: true,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow("👋 推送已取消"));
      return;
    }
  }

  // 执行推送
  console.log(chalk.cyan(`\n🚀 开始推送 ${branch} 分支...\n`));

  const results = { success: [], failed: [] };

  for (const platform of enabledPlatforms) {
    const platformInfo = PLATFORMS[platform];
    const spinner = ora(
      `正在推送到 ${platformInfo.icon} ${platform}...`
    ).start();

    try {
      await pushToRemote(platform, branch, options);
      spinner.succeed(`${platformInfo.icon} ${platform} 推送成功`);
      results.success.push(platform);
    } catch (error) {
      spinner.fail(`${platformInfo.icon} ${platform} 推送失败`);
      results.failed.push({ platform, error: error.message });
    }
  }

  // 显示结果
  console.log(chalk.cyan("\n📊 推送结果:\n"));
  if (results.success.length > 0) {
    console.log(chalk.green(`✅ 成功: ${results.success.join(", ")}`));
  }
  if (results.failed.length > 0) {
    console.log(
      chalk.red(`❌ 失败: ${results.failed.map((f) => f.platform).join(", ")}`)
    );
    results.failed.forEach((f) => {
      console.log(chalk.red(`   ${f.platform}: ${f.error}`));
    });

    // 优化的错误提示
    console.log(chalk.yellow("\n🔧 故障排除建议:"));
    console.log(chalk.yellow("   • 检查用户名配置是否与平台账户名一致"));
    console.log(chalk.yellow("   • 确保SSH密钥已正确配置并添加到各平台"));
    console.log(chalk.yellow("   • 首次推送可能需要确认SSH主机验证"));
    console.log(chalk.gray("\n📝 配置维护:"));
    console.log(`   • 重新配置: ${chalk.cyan("mgit config")}`);
    console.log(`   • 编辑配置: ${chalk.cyan(".mgit-push.json")}`);
    console.log(`   • 查看状态: ${chalk.cyan("mgit status")}`);
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

  const branch = getCurrentBranch();
  console.log(chalk.cyan("\n📊 多平台 Git 状态\n"));
  console.log(chalk.blue(`当前分支: ${branch}\n`));

  for (const [platform, platformConfig] of Object.entries(config.platforms)) {
    if (platformConfig.enabled) {
      const platformInfo = PLATFORMS[platform];
      const exists = remoteExists(platform);

      console.log(`${platformInfo.icon} ${chalk.bold(platformInfo.name)}`);
      console.log(`   用户名: ${platformConfig.username}`);
      console.log(`   URL: ${platformConfig.url}`);
      console.log(
        `   状态: ${exists ? chalk.green("✅ 已配置") : chalk.red("❌ 未配置")}`
      );
      console.log();
    }
  }
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
  .action(async () => {
    await initConfig();
  });

program
  .command("status")
  .alias("st")
  .description("显示远程仓库状态")
  .action(async () => {
    await showStatus();
  });

program
  .command("config")
  .description("重新配置")
  .action(async () => {
    await initConfig();
  });

// 默认行为：只显示帮助，不执行推送
if (process.argv.length === 2) {
  console.log(chalk.cyan("🚀 mgit-push - 智能多平台 Git 推送工具\n"));

  if (isGitRepo()) {
    const config = loadConfig();
    if (config) {
      console.log(chalk.green("✅ 已配置完成"));
      console.log(`${chalk.cyan("🎯 推送代码:")} ${chalk.bold("mgit push")}`);
      console.log(`${chalk.cyan("📊 查看状态:")} ${chalk.bold("mgit status")}`);
      console.log(`${chalk.cyan("🔧 重新配置:")} ${chalk.bold("mgit config")}`);
    } else {
      console.log(chalk.yellow("⚠️ 尚未配置"));
      console.log(`${chalk.cyan("🎯 开始配置:")} ${chalk.bold("mgit init")}`);
    }
  } else {
    console.log(chalk.red("❌ 当前目录不是 Git 仓库"));
  }

  console.log(
    `${chalk.gray("\n📖 查看所有命令:")} ${chalk.bold("mgit --help")}`
  );
} else {
  program.parse(process.argv);
}