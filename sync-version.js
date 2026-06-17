#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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