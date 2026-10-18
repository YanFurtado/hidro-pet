@echo off
cd /d "%~dp0"
echo Iniciando o Hidro PET... abra http://localhost:3000 no navegador.
echo Para os professores usarem no celular, use o endereco IP deste computador (ex.: http://192.168.0.10:3000) na mesma rede Wi-Fi.
start "" http://localhost:3000
node server.js
pause
