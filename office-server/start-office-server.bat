@echo off
title FRT Barabanki - Office Call Recording Server
cd /d "%~dp0"
echo =======================================================
echo   Starting FRT Barabanki Local Call Recording Server...
echo =======================================================
node server.js
pause
