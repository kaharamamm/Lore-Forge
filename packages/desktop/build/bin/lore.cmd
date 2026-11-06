@echo off
rem lore: the Lore-Forge command-line tool (lore check, lore codex, ...), installed with the app.
rem It runs the app's own Electron as plain Node. Add this folder to PATH to type "lore" anywhere.
setlocal
set "RES=%~dp0.."
if not defined LORE_FORGE_FONTS set "LORE_FORGE_FONTS=%RES%\fonts"
set ELECTRON_RUN_AS_NODE=1
"%RES%\..\Lore-Forge.exe" "%RES%\app.asar\dist\cli.cjs" %*
