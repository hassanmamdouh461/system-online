@echo off
echo =========================================
echo Starting BrewMaster POS (system333)
echo Using portable Node.js v20.11.1
echo =========================================
set PATH=%~dp0..\..\node-v20.11.1-win-x64;%PATH%
cd %~dp0..
npm run electron:dev
pause
