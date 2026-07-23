@echo off
cd /d "%~dp0.."
if not exist node_modules npm install
if not exist build npm run build
npm start
