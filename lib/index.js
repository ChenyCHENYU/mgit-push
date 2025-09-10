#!/usr/bin/env node

/**
 * mgit-push - 智能多平台 Git 推送工具
 * @author CHENYU
 */

const { program } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = require('../package.json').version;

// ============ 平台配置 ============
const PLATFORMS = {
  github: {
    name: 'GitHub',
    icon: '🐙',
    pattern: /github\.com[:/]([^/]+)\/([^/.]+)/i,
    template: 'git@github.com:{username}/{repo}.git'
  },
  gitee: {
    name: 'Gitee', 
    icon: '🔥',
    pattern: /gitee\.com[:/]([^/]+)\/([^/.]+)/i,
    template: 'git@gitee.com:{username}/{repo}.git'
  },
  gitlab: {
    name: 'GitLab',
    icon: '🦊', 
    pattern: /gitlab\.com[:/]([^/]+)\/([^/.]+)/i,
    template: 'git@gitlab.com:{username}/{repo}.git'
  },
  gitcode: {
    name: 'GitCode',
    icon: '💻',
    pattern: /gitcode\.net[:/]([^/]+)\/([^/.]+)/i,
    template: 'git@gitcode.net:{username}/{repo}.git'
  }
};

// ============ Git 工具函数 ============
function isGitRepo() {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch() {
  try {
    return execSync('git branch --show-current', { encoding: 'utf8' }).trim() || 'main';
  } catch {
    return 'main';
  }
}

function getRemotes() {
  try {
    const output = execSync('git remote -v', { encoding: 'utf8' });
    const remotes = {};
    
    output.split('\n').forEach(line => {
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
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    return status.length > 0;
  } catch {
    return false;
  }
}

function remoteExists(name) {
  try {
    execSync(`git remote get-url ${name}`, { stdio: 'pipe' });
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
        url
      };
    }
  }
  return null;
}

function escapeArg(arg) {
  return process.platform === 'win32' 
    ? `"${arg.replace(/"/g, '""')}"`
    : `'${arg.replace(/'/g, "'\"'\"'")}'`;
}

// ============ 配置管理 ============
const CONFIG_FILE = '.mgit-push.json';

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (error) {
    console.log(chalk.yellow('⚠️ 配置文件读取失败'));
  }
  return null;
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error(chalk.red('❌ 配置保存失败:'), error.message);
    return false;
  }
}

function analyzeRepo() {
  const info = { username: null, repo: null, platforms: [] };
  
  try {
    const remotes = getRemotes();
    
    // 从现有远程解析信息
    for (const [name, urls] of Object.entries(remotes)) {
      const url = urls.fetch || urls.push;
      if (url) {
        const parsed = parseRepoInfo(url);
        if (parsed) {
          if (!info.username) info.username = parsed.username;
          if (!info.repo) info.repo = parsed.repo;
          info.platforms.push({ name, ...parsed });
        }
      }
    }
    
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
  console.log(chalk.cyan('\n🚀 mgit-push 配置向导\n'));
  
  const repoInfo = analyzeRepo();
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'username',
      message: '请输入您的 Git 用户名:',
      default: repoInfo.username,
      validate: input => input.trim().length > 0 || '用户名不能为空'
    },
    {
      type: 'input',
      name: 'repo',
      message: '请输入仓库名称:',
      default: repoInfo.repo,
      validate: input => input.trim().length > 0 || '仓库名不能为空'
    },
    {
      type: 'checkbox',
      name: 'platforms',
      message: '请选择要推送的平台:',
      choices: Object.entries(PLATFORMS).map(([key, config]) => ({
        name: `${config.icon} ${config.name}`,
        value: key,
        checked: ['github', 'gitee'].includes(key)
      }))
    }
  ]);

  const config = {
    username: answers.username,
    repository: answers.repo,
    platforms: {},
    createdAt: new Date().toISOString()
  };

  // 为每个平台生成配置
  for (const platform of answers.platforms) {
    const platformConfig = PLATFORMS[platform];
    const url = platformConfig.template
      .replace('{username}', answers.username)
      .replace('{repo}', answers.repo);
    
    config.platforms[platform] = {
      enabled: true,
      url: url
    };
  }

  if (saveConfig(config)) {
    console.log(chalk.green('\n✅ 配置已保存！'));
    console.log(chalk.cyan('\n📋 配置摘要:'));
    console.log(`用户名: ${config.username}`);
    console.log(`仓库名: ${config.repository}`);
    console.log(`平台: ${answers.platforms.map(p => PLATFORMS[p].icon + ' ' + p).join(', ')}`);
  }
  
  return config;
}

async function setupRemotes(config) {
  const spinner = ora('正在配置远程仓库...').start();
  
  for (const [platform, platformConfig] of Object.entries(config.platforms)) {
    if (platformConfig.enabled) {
      try {
        const platformInfo = PLATFORMS[platform];
        
        if (remoteExists(platform)) {
          execSync(`git remote set-url ${platform} ${escapeArg(platformConfig.url)}`, { stdio: 'pipe' });
        } else {
          execSync(`git remote add ${platform} ${escapeArg(platformConfig.url)}`, { stdio: 'pipe' });
        }
        
        spinner.text = `${platformInfo.icon} ${platform} 配置完成`;
      } catch (error) {
        spinner.fail(`${platform} 配置失败: ${error.message}`);
        return false;
      }
    }
  }
  
  spinner.succeed('远程仓库配置完成');
  return true;
}

function pushToRemote(platform, branch, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ['push'];
    if (options.force) args.push('--force');
    if (options.tags) args.push('--tags');
    args.push(platform, branch);

    const git = spawn('git', args, { stdio: ['inherit', 'pipe', 'pipe'] });
    
    let output = '';
    let error = '';
    
    git.stdout.on('data', data => output += data.toString());
    git.stderr.on('data', data => error += data.toString());
    
    git.on('close', code => {
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
    console.log(chalk.red('❌ 当前目录不是 Git 仓库'));
    return;
  }

  // 检查未提交的更改
  if (hasUncommittedChanges()) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: chalk.yellow('⚠️ 检测到未提交的更改，请选择:'),
        choices: [
          { name: '💾 提交更改后继续', value: 'commit' },
          { name: '⚠️ 忽略并继续', value: 'ignore' },
          { name: '❌ 取消推送', value: 'cancel' }
        ]
      }
    ]);

    if (action === 'cancel') {
      console.log(chalk.yellow('👋 推送已取消'));
      return;
    }
    
    if (action === 'commit') {
      const { message } = await inquirer.prompt([
        {
          type: 'input',
          name: 'message',
          message: '请输入提交信息:',
          validate: input => input.trim().length > 0 || '提交信息不能为空'
        }
      ]);
      
      try {
        execSync('git add .');
        execSync(`git commit -m ${escapeArg(message)}`);
        console.log(chalk.green('✅ 更改已提交'));
      } catch (error) {
        console.error(chalk.red('❌ 提交失败:'), error.message);
        return;
      }
    }
  }

  // 获取配置
  let config = loadConfig();
  if (!config) {
    console.log(chalk.yellow('⚠️ 未找到配置文件，开始初始化...'));
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
    console.log(chalk.red('❌ 没有启用的推送平台'));
    return;
  }

  const branch = options.branch || getCurrentBranch();

  // 确认推送
  if (!options.yes) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `确认推送 ${chalk.cyan(branch)} 分支到 ${chalk.green(enabledPlatforms.join(', '))}?`,
        default: true
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('👋 推送已取消'));
      return;
    }
  }

  // 执行推送
  console.log(chalk.cyan(`\n🚀 开始推送 ${branch} 分支...\n`));
  
  const results = { success: [], failed: [] };
  
  for (const platform of enabledPlatforms) {
    const platformInfo = PLATFORMS[platform];
    const spinner = ora(`正在推送到 ${platformInfo.icon} ${platform}...`).start();
    
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
  console.log(chalk.cyan('\n📊 推送结果:\n'));
  if (results.success.length > 0) {
    console.log(chalk.green(`✅ 成功: ${results.success.join(', ')}`));
  }
  if (results.failed.length > 0) {
    console.log(chalk.red(`❌ 失败: ${results.failed.map(f => f.platform).join(', ')}`));
    results.failed.forEach(f => {
      console.log(chalk.red(`   ${f.platform}: ${f.error}`));
    });
  }
}

async function showStatus() {
  if (!isGitRepo()) {
    console.log(chalk.red('❌ 当前目录不是 Git 仓库'));
    return;
  }

  const config = loadConfig();
  if (!config) {
    console.log(chalk.yellow('⚠️ 未找到配置文件，请运行 "mgit init"'));
    return;
  }

  const branch = getCurrentBranch();
  console.log(chalk.cyan('\n📊 多平台 Git 状态\n'));
  console.log(chalk.blue(`当前分支: ${branch}\n`));

  for (const [platform, platformConfig] of Object.entries(config.platforms)) {
    if (platformConfig.enabled) {
      const platformInfo = PLATFORMS[platform];
      const exists = remoteExists(platform);
      
      console.log(`${platformInfo.icon} ${chalk.bold(platformInfo.name)}`);
      console.log(`   URL: ${platformConfig.url}`);
      console.log(`   状态: ${exists ? chalk.green('✅ 已配置') : chalk.red('❌ 未配置')}`);
      console.log();
    }
  }
}

// ============ CLI 命令定义 ============
program
  .name('mgit-push')
  .description('智能多平台 Git 推送工具')
  .version(VERSION);

program
  .command('push [branch]')
  .description('推送到配置的平台')
  .option('-f, --force', '强制推送')
  .option('-t, --tags', '推送标签')
  .option('-y, --yes', '跳过确认')
  .action(async (branch, options) => {
    await pushToAll({ branch, ...options });
  });

program
  .command('init')
  .description('初始化配置')
  .action(async () => {
    await initConfig();
  });

program
  .command('status')
  .alias('st')
  .description('显示远程仓库状态')
  .action(async () => {
    await showStatus();
  });

program
  .command('config')
  .description('重新配置')
  .action(async () => {
    await initConfig();
  });

// 默认行为
if (process.argv.length === 2) {
  // 没有参数时，尝试直接推送
  if (isGitRepo() && loadConfig()) {
    pushToAll().catch(error => {
      console.error(chalk.red('❌ 推送失败:'), error.message);
    });
  } else {
    console.log(chalk.cyan('🚀 mgit-push - 智能多平台 Git 推送工具\n'));
    console.log(chalk.yellow('💡 首次使用？运行 "mgit init" 开始配置'));
    console.log(chalk.gray('📖 需要帮助？运行 "mgit --help" 查看所有命令\n'));
  }
} else {
  program.parse(process.argv);
}