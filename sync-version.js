#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取 package.json 获取新版本
const packageJsonPath = path.join(__dirname, 'package.json');
const pkgRaw = fs.readFileSync(packageJsonPath, 'utf8');
const packageJson = JSON.parse(pkgRaw);
const newVersion = packageJson.version;

// 更新 Cargo.toml
const cargoTomlPath = path.join(__dirname, 'src-tauri', 'Cargo.toml');
let cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf8');

// 正则替换 [package] 下的 version
const updatedCargoToml = cargoTomlContent.replace(
  /^version\s*=\s*["'][^"']+["']/m,
  `version = "${newVersion}"`
);

fs.writeFileSync(cargoTomlPath, updatedCargoToml);
console.log(`✅ Cargo.toml 版本同步完成：${newVersion}`);

// 自动刷新 Cargo.lock
try {
  const srcTauriDir = path.join(__dirname, 'src-tauri');
  // 仅更新当前项目版本，不升级依赖包版本
  execSync('cargo update --package keyvault', {
    cwd: srcTauriDir,
    stdio: 'inherit'
  });
  console.log(`✅ Cargo.lock 已同步刷新`);
} catch (err) {
  console.warn(`⚠️ 自动更新 Cargo.lock 失败，请手动运行 cd src-tauri && cargo update --package keyvault`);
}