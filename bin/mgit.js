#!/usr/bin/env node

"use strict";

const path = require("path");

// 检查 Node.js 版本
const nodeVersion = process.version;
if (parseFloat(nodeVersion.slice(1)) < 14) {
  console.error(
    `❌ mgit-push 需要 Node.js 14.0.0 或更高版本，当前版本: ${nodeVersion}`
  );
  process.exit(1);
}

// 全局错误处理
process.on("unhandledRejection", (error) => {
  console.error("❌ 错误:", error.message);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n👋 操作已取消");
  process.exit(0);
});

// 运行主程序
try {
  require(path.join(__dirname, "..", "lib", "index.js"));
} catch (error) {
  console.error("❌ 启动失败:", error.message);
  process.exit(1);
}
