# CineLocal - Instruções de instalação e uso

Este guia reúne os passos essenciais para configurar e executar o projeto em um computador Windows.

## 1. Pré-requisitos

- Windows 10 ou 11
- Node.js LTS instalado no sistema, ou uma cópia portátil em `bin/node.exe`
- Acesso à internet na primeira instalação para baixar as dependências
- Opcionalmente: FFmpeg para reprodução de arquivos MKV/AVI e transcodificação

## 2. Instalar dependências

1. Abra a pasta do projeto.
2. Execute o arquivo `instalar dependências.bat`.
3. **Se a máquina não tiver Node.js instalado**, o próprio script detecta a ausência e pergunta se você deseja baixar a versão portátil oficial automaticamente para a pasta `bin/`. Basta pressionar Enter (`S`)!
4. Aguarde a instalação do `npm install --include=dev`.
5. Se o Node.js não estiver no PATH do Windows, o script utiliza a versão portátil em `bin/node.exe` e `bin/npm.cmd`.

O script:
- valida se o `package.json` existe;
- verifica Node.js e npm (com opção de download portátil automático);
- instala as dependências do projeto;
- mantém o cache do npm em `.cache/npm` dentro da pasta do app;
- anuncia se o FFmpeg não foi encontrado;
- extrai automaticamente o arquivo `EXTRAIA.rar` (caso exista) na raiz do projeto sem criar uma nova pasta.

## 3. Executar o projeto

Depois da instalação, execute:

- `start.bat` no Windows

Ele iniciará o servidor local e abrirá o navegador em:

- https://localhost:3050

## 4. Estrutura importante

```text
CineLocal/
├── start.bat
├── instalar dependências.bat
├── INSTRUCOES.md
├── package.json
├── server.ts
├── src/
├── data/
├── certs/
├── bin/
└── .cache/
```

## 5. Solução de problemas

### Node.js não encontrado
- Instale o Node.js LTS
- ou coloque `node.exe` e `npm.cmd` na pasta `bin`

### Dependências não instalaram
- Verifique a internet
- execute o script novamente
- confirme que a pasta `node_modules` foi criada

### FFmpeg não detectado
- Instale FFmpeg no sistema
- ou coloque `ffmpeg.exe` e `ffprobe.exe` em `bin`

## 6. Uso portátil

Se você quiser levar o projeto em pendrive ou disco externo:

1. Instale as dependências em um computador com internet.
2. Copie a pasta inteira do projeto, incluindo `node_modules`.
3. Use `start.bat` em outro PC sem reinstalar tudo.

> Dica: o cache do npm fica em `.cache/npm`, no mesmo disco onde o projeto está.

## 7. Observações

- O app usa HTTPS local para o servidor e para o Chromecast.
- O arquivo de dados principal fica em `data/library.json`.
- O servidor local usa a porta `3050` por padrão.
