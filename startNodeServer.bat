#!/bin/bash
start /B node server.js
timeout /t 5 /nobreak > nul
start "" "http://localhost:8082"