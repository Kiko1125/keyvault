#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const newVersion = process.env.VERSION;
if (!newVersion) {
  throw new Error('❌ 未读取到 VERSION 环境变量，请使用 npm run release 执行，不要直接 node sync-version.js');
}
console.log(`🔄 同步Cargo版本至: ${newVersion}`);

// 仅同步 src-tauri/Cargo.toml
const cargoTomlPath = path.join(__dirname, 'src-tauri', 'Cargo.toml');
let cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf8');
const updatedCargoToml = cargoTomlContent.replace(
  /^version\s*=\s*["'][^"']+["']/m,
  `version = "${newVersion}"`
);
fs.writeFileSync(cargoTomlPath, updatedCargoToml);
console.log(`✅ Cargo.toml 版本同步完成：${newVersion}`);

// 自动刷新 Cargo.lock
try {
  const srcTauriDir = path.join(__dirname, 'src-tauri');
  execSync('cargo update --package keyvault', {
    cwd: srcTauriDir,
    stdio: 'inherit'
  });
  console.log(`✅ Cargo.lock 已自动刷新`);
} catch (err) {
  console.warn(`⚠️ Cargo.lock 更新失败，手动执行：cd src-tauri && cargo update --package keyvault`);
}

console.log('\n🎉 Cargo版本同步完成，即将执行standard-version');