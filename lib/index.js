#!/usr/bin/env node

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
    pattern: /gitcode\.com[:/]([^/]+)\/([^/.]+)/i,
    template: 'git@gitcode.com:{username}/{repo}.git'
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

function getGitUserName() {
  try {
    return execSync('git config user.name', { encoding: 'utf8' }).trim() || 'ChenYu';
  } catch {
    return 'ChenYu';
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
  const info = { 
    repo: null, 
    platforms: {},  // 改为对象，存储各平台的用户名
    gitUserName: getGitUserName()
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
          info.platforms[parsed.platform] = {
            username: parsed.username,
            remoteName: name,
            url: url
          };
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
  
  // 首先获取仓库名
  const repoAnswer = await inquirer.prompt([
    {
      type: 'input',
      name: 'repo',
      message: '请输入仓库名称:',
      default: repoInfo.repo,
      validate: input => input.trim().length > 0 || '仓库名不能为空'
    }
  ]);

  // 选择要配置的平台
  const platformAnswer = await inquirer.prompt([
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

  if (platformAnswer.platforms.length === 0) {
    console.log(chalk.red('❌ 至少选择一个平台'));
    return;
  }

  // 询问用户名配置方式
  const usernameMode = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: '请选择用户名配置方式:',
      choices: [
        { 
          name: '🔄 所有平台使用同一个用户名 (适合各平台账户名相同的情况)', 
          value: 'same' 
        },
        { 
          name: '⚙️  为每个平台单独设置用户名 (适合各平台账户名不同的情况)', 
          value: 'individual' 
        }
      ],
      default: 'individual'
    }
  ]);

  let commonUsername = null;
  const platformConfigs = {};

  if (usernameMode.mode === 'same') {
    // 使用相同用户名
    const usernameAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'username',
        message: '请输入统一的用户名 (将应用到所有选中的平台):',
        default: repoInfo.gitUserName,
        validate: input => input.trim().length > 0 || '用户名不能为空'
      }
    ]);
    commonUsername = usernameAnswer.username;
  }

  // 为每个平台配置用户名
  for (const platform of platformAnswer.platforms) {
    const platformInfo = PLATFORMS[platform];
    const existingInfo = repoInfo.platforms[platform];
    
    let username = commonUsername;
    
    if (!username) {
      // 单独设置模式：为每个平台设置用户名
      const hasExisting = existingInfo?.username;
      const defaultValue = hasExisting || repoInfo.gitUserName;
      const sourceInfo = hasExisting ? '(从现有配置检测)' : '(Git用户名)';
      
      console.log(chalk.cyan(`\n${platformInfo.icon} 配置 ${platformInfo.name} 平台`));
      console.log(chalk.gray(`   建议值: ${chalk.cyan(defaultValue)} ${sourceInfo}`));
      
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'username',
          message: `请输入您在 ${platformInfo.name} 的账户名:`,
          default: defaultValue,
          validate: input => input.trim().length > 0 || '用户名不能为空'
        }
      ]);
      username = answer.username;
    }

    const url = platformInfo.template
      .replace('{username}', username)
      .replace('{repo}', repoAnswer.repo);
    
    platformConfigs[platform] = {
      enabled: true,
      username: username,
      url: url
    };
  }

  const config = {
    repository: repoAnswer.repo,
    platforms: platformConfigs,
    createdAt: new Date().toISOString()
  };

  if (saveConfig(config)) {
    console.log(chalk.green('\n✅ 配置已保存！'));
    
    // 配置摘要
    console.log(chalk.cyan('\n📋 配置摘要:'));
    console.log(`📁 仓库名: ${chalk.bold(config.repository)}`);
    console.log('🔗 平台配置:');
    Object.entries(config.platforms).forEach(([platform, config]) => {
      const platformInfo = PLATFORMS[platform];
      console.log(`   ${platformInfo.icon} ${chalk.bold(platform)}: ${chalk.cyan(config.username)}`);
    });
    
    // 配置文件维护说明
    console.log(chalk.yellow('\n🔧 配置文件维护:'));
    console.log(`📄 配置文件位置: ${chalk.cyan('.mgit-push.json')}`);
    console.log('📝 维护方式:');
    console.log(`   • 运行 ${chalk.green('mgit config')} 重新配置`);
    console.log(`   • 直接编辑 ${chalk.cyan('.mgit-push.json')} 文件`);
    
    // 使用指南
    console.log(chalk.cyan('\n🚀 接下来您可以:'));
    console.log(`🎯 推送到所有平台: ${chalk.green('mgit')} 或 ${chalk.green('mgit push')}`);
    console.log(`📊 查看状态: ${chalk.green('mgit status')}`);
    console.log(`📖 查看帮助: ${chalk.green('mgit --help')}`);
    console.log(chalk.gray('\n💡 提示: 直接运行 "mgit" 即可开始推送！'));
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
    
    // 添加提示信息
    console.log(chalk.yellow('\n💡 推送失败提示:'));
    console.log(chalk.yellow('   如遇推送失败，请检查配置文件中的用户名与平台账户名是否一致'));
    console.log(chalk.yellow('   运行 "mgit config" 重新配置或手动编辑 .mgit-push.json 文件'));
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
      console.log(`   用户名: ${platformConfig.username}`);
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
    console.log(chalk.yellow('🎯 开始推送？运行 "mgit push" 推送到所有平台'));
    console.log(chalk.gray('📖 需要帮助？运行 "mgit --help" 查看所有命令\n'));
  }
} else {
  program.parse(process.argv);
}